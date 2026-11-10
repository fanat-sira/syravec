package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"sync"
	"time"
)

// Job IDs are random bearer capabilities. Results are bounded, transient and never
// exposed in a listing. Browser disconnects do not cancel a paid provider request.
type compositionJob struct {
	hash         [32]byte
	created      time.Time
	cancel       context.CancelFunc
	done         bool
	acknowledged bool
	status       int
	result       []byte
}
type compositionJobs struct {
	sync.Mutex
	entries map[string]*compositionJob
}

var validJobID = regexp.MustCompile(`^[a-f0-9-]{36}$`)

type jobResponse struct {
	header http.Header
	status int
	bytes.Buffer
}

func (w *jobResponse) Header() http.Header    { return w.header }
func (w *jobResponse) WriteHeader(status int) { w.status = status }
func (w *jobResponse) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.Buffer.Write(p)
}
func (s *Server) startJob(w http.ResponseWriter, r *http.Request) {
	id := r.Header.Get("X-Composition-Job")
	if !validJobID.MatchString(id) {
		fail(w, 400, "invalid_job", "неверный идентификатор запроса")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 128<<10))
	if err != nil || !json.Valid(body) {
		fail(w, 400, "invalid_request", "неверный запрос")
		return
	}
	hash := sha256.Sum256(body)
	s.jobs.Lock()
	if s.jobs.entries == nil {
		s.jobs.entries = map[string]*compositionJob{}
	}
	for key, job := range s.jobs.entries {
		if job.acknowledged && time.Since(job.created) > 30*time.Minute {
			job.cancel()
			delete(s.jobs.entries, key)
		}
	}
	if job := s.jobs.entries[id]; job != nil {
		if job.hash != hash {
			s.jobs.Unlock()
			fail(w, 409, "job_conflict", "запрос уже существует")
			return
		}
		s.jobs.Unlock()
		respond(w, 202, map[string]string{"status": "pending"})
		return
	}
	if len(s.jobs.entries) >= 1024 {
		s.jobs.Unlock()
		fail(w, 503, "jobs_busy", "сервис занят, попробуй позже")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
	job := &compositionJob{hash: hash, created: time.Now(), cancel: cancel}
	s.jobs.entries[id] = job
	s.jobs.Unlock()
	request := r.Clone(ctx)
	request.Header.Del("X-Composition-Job")
	request.Body = io.NopCloser(bytes.NewReader(body))
	go func() {
		defer cancel()
		result := &jobResponse{header: make(http.Header)}
		s.compose(result, request)
		s.jobs.Lock()
		defer s.jobs.Unlock()
		if job.done {
			return
		}
		job.status = result.status
		job.result = append([]byte(nil), result.Bytes()...)
		if job.status == 0 || len(job.result) == 0 {
			job.status = 504
			job.result = []byte(`{"error":{"message":"сборка прервана, повтори запрос"}}`)
		}
		job.done = true
	}()
	respond(w, 202, map[string]string{"status": "pending"})
}
func (s *Server) readJob(w http.ResponseWriter, r *http.Request) {
	s.jobs.Lock()
	defer s.jobs.Unlock()
	job := s.jobs.entries[r.PathValue("id")]
	if job == nil || job.acknowledged && time.Since(job.created) > 30*time.Minute {
		fail(w, 404, "job_expired", "результат запроса больше недоступен, повтори сборку")
		return
	}
	if r.Method == "DELETE" {
		job.acknowledged = true
		job.created = time.Now()
		job.cancel()
		job.done = true
		job.status = 409
		job.result = []byte(`{"error":{"message":"сборка отменена"}}`)
		respond(w, 200, map[string]string{"status": "cancelled"})
		return
	}
	if !job.done {
		respond(w, 202, map[string]string{"status": "pending"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(job.status)
	_, _ = w.Write(job.result)
}
