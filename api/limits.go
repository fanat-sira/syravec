package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const aiDailyPerIP = 20
const aiDailyTotal = 100
const aiWindow = 24 * time.Hour

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
func recentCalls(calls []time.Time, now time.Time) []time.Time {
	result := make([]time.Time, 0, len(calls))
	for _, at := range calls {
		if at.After(now.Add(-aiWindow)) {
			result = append(result, at)
		}
	}
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
	if usage.IPCalls == nil || len(usage.Calls) > aiDailyTotal || len(usage.IPCalls) > aiDailyTotal {
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
		if err != nil || len(decoded) != 32 || len(calls) > aiDailyPerIP {
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

// Reserve immediately before the main model call. Failed/cancelled dispatched
// attempts still count: the provider may already have consumed tokens.
func (s *Server) reserveAI(ip string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	calls := recentCalls(s.calls, now)
	key := ipKey(ip)
	ips := make(map[string][]time.Time)
	for id, times := range s.ipCalls {
		if recent := recentCalls(times, now); len(recent) > 0 {
			ips[id] = recent
		}
	}
	if len(ips[key]) >= aiDailyPerIP {
		return "ip_daily_limit", nil
	}
	if len(calls) >= aiDailyTotal {
		return "service_daily_limit", nil
	}
	next := aiUsage{Calls: append(calls, now), IPCalls: ips}
	next.IPCalls[key] = append(next.IPCalls[key], now)
	if err := s.saveUsage(next); err != nil {
		return "", err
	}
	s.calls = next.Calls
	s.ipCalls = next.IPCalls
	return "", nil
}
