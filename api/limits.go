package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"
)

const aiHourlyPerIP = 5
const aiDailyPerIP = 20
const aiDailyTotal = 150
const aiWindow = 24 * time.Hour

type aiQuotaLimits struct {
	HourlyPerIP int
	DailyPerIP  int
	DailyTotal  int
}

func (s *Server) quotaLimits() aiQuotaLimits {
	limits := s.aiLimits
	if limits.HourlyPerIP == 0 {
		limits.HourlyPerIP = aiHourlyPerIP
	}
	if limits.DailyPerIP == 0 {
		limits.DailyPerIP = aiDailyPerIP
	}
	if limits.DailyTotal == 0 {
		limits.DailyTotal = aiDailyTotal
	}
	return limits
}

func (s *Server) configureQuotas() error {
	for _, setting := range []struct {
		name     string
		fallback int
		target   *int
	}{
		{"AI_IP_HOURLY_LIMIT", aiHourlyPerIP, &s.aiLimits.HourlyPerIP},
		{"AI_IP_DAILY_LIMIT", aiDailyPerIP, &s.aiLimits.DailyPerIP},
		{"AI_SERVICE_DAILY_LIMIT", aiDailyTotal, &s.aiLimits.DailyTotal},
	} {
		value, err := strconv.Atoi(env(setting.name, strconv.Itoa(setting.fallback)))
		if err != nil || value < 1 {
			return fmt.Errorf("%s must be a positive integer", setting.name)
		}
		*setting.target = value
	}
	return nil
}

// Only the main planner receives this context value; Guard never reserves quota.
type mainModelIPKey struct{}

type aiQuotaError struct {
	code       string
	retryAfter int
	cause      error
}

func (e aiQuotaError) Error() string { return e.code }
func (e aiQuotaError) Unwrap() error { return e.cause }

// When limits are lowered, enough entries must expire to put count BELOW the
// new limit, not merely the oldest entry. All input slices are sorted copies.
func quotaWait(calls []time.Time, limit int, window time.Duration, now time.Time) time.Duration {
	if len(calls) < limit {
		return 0
	}
	return calls[len(calls)-limit].Add(window).Sub(now)
}

type aiUsage struct {
	Calls   []time.Time            `json:"calls"`
	IPCalls map[string][]time.Time `json:"ipCalls"`
}

func (s *Server) clientIP(r *http.Request) string {
	// The API has no published port. Its nginx overwrites this header after
	// resolving the host proxy's address; never use the user's leftmost XFF.
	if s.trustProxy {
		if ip := net.ParseIP(r.Header.Get("X-Real-IP")); ip != nil {
			return ip.String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return "unknown"
}
func ipKey(ip string) string { sum := sha256.Sum256([]byte(ip)); return hex.EncodeToString(sum[:]) }
func recentCalls(calls []time.Time, now time.Time, window time.Duration) []time.Time {
	result := make([]time.Time, 0, len(calls))
	for _, at := range calls {
		if at.After(now.Add(-window)) {
			result = append(result, at)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Before(result[j]) })
	return result
}
func (s *Server) loadUsage() error {
	if s.usagePath == "" {
		return nil
	}
	raw, err := os.ReadFile(s.usagePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var usage aiUsage
	if err = json.Unmarshal(raw, &usage); err != nil {
		return err
	}
	if usage.IPCalls == nil {
		return errors.New("invalid AI usage state")
	}
	now := time.Now()
	for _, at := range usage.Calls {
		if at.IsZero() || at.After(now.Add(time.Minute)) {
			return errors.New("invalid AI usage timestamp")
		}
	}
	for key, calls := range usage.IPCalls {
		decoded, err := hex.DecodeString(key)
		if err != nil || len(decoded) != 32 {
			return errors.New("invalid IP usage state")
		}
		for _, at := range calls {
			if at.IsZero() || at.After(now.Add(time.Minute)) {
				return errors.New("invalid IP usage timestamp")
			}
		}
	}
	s.calls = usage.Calls
	s.ipCalls = usage.IPCalls
	return nil
}
func (s *Server) saveUsage(usage aiUsage) error {
	if s.usagePath == "" {
		return nil
	}
	raw, err := json.Marshal(usage)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(s.usagePath), ".ai-usage-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(raw); err != nil {
		file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), s.usagePath)
}

// Reserve at dispatch of EACH main-model POST, including a bounded repair.
// Invalid input, Guard, templates and requests cancelled before dispatch do not
// count. A dispatched attempt stays counted even if the provider later fails.
func (s *Server) reserveAI(ctx context.Context, ip string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	now := time.Now()
	limits := s.quotaLimits()
	calls := recentCalls(s.calls, now, aiWindow)
	key := ipKey(ip)
	ips := make(map[string][]time.Time)
	for id, times := range s.ipCalls {
		if recent := recentCalls(times, now, aiWindow); len(recent) > 0 {
			ips[id] = recent
		}
	}
	hourly := recentCalls(ips[key], now, time.Hour)
	var wait time.Duration
	code := ""
	for _, quota := range []struct {
		code string
		wait time.Duration
	}{
		{"ip_hourly_limit", quotaWait(hourly, limits.HourlyPerIP, time.Hour, now)},
		{"ip_daily_limit", quotaWait(ips[key], limits.DailyPerIP, aiWindow, now)},
		{"service_daily_limit", quotaWait(calls, limits.DailyTotal, aiWindow, now)},
	} {
		// Access returns only after ALL exceeded quotas allow another request.
		if quota.wait > wait {
			wait = quota.wait
			code = quota.code
		}
	}
	if wait > 0 {
		return aiQuotaError{code: code, retryAfter: max(1, int(math.Ceil(wait.Seconds())))}
	}
	next := aiUsage{Calls: append(calls, now), IPCalls: ips}
	next.IPCalls[key] = append(next.IPCalls[key], now)
	if err := s.saveUsage(next); err != nil {
		return aiQuotaError{code: "quota_unavailable", cause: err}
	}
	s.calls = next.Calls
	s.ipCalls = next.IPCalls
	return nil
}

func respondQuota(w http.ResponseWriter, quota aiQuotaError) {
	w.Header().Set("Retry-After", strconv.Itoa(quota.retryAfter))
	minutes := (quota.retryAfter + 59) / 60
	respond(w, http.StatusTooManyRequests, map[string]any{"error": map[string]any{
		"code":              quota.code,
		"message":           fmt.Sprintf("Лимит AI-генераций исчерпан. Повторите через %d мин.", minutes),
		"retryAfterSeconds": quota.retryAfter,
	}})
}
