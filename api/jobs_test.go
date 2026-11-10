package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestJobSurvivesDisconnectAndDuplicateSubmission(t *testing.T) {
	s := fixture()
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		content := `{"items":[{"assetId":"book-main","preferredX":0.4,"preferredY":0.6,"rotation":0},{"assetId":"lamp-main","preferredX":0.7,"preferredY":0.3,"rotation":0}]}`
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}}}})
	}))
	defer upstream.Close()
	s.key, s.url, s.format = "test", upstream.URL, "json_schema"
	r := req()
	r.Planner = "llm"
	body, _ := json.Marshal(r)
	id := "12345678-1234-1234-1234-123456789abc"
	handler := s.routes()
	submit := func(body string) *httptest.ResponseRecorder {
		ctx, cancel := context.WithCancel(context.Background())
		request := httptest.NewRequest("POST", "/api/v1/compositions", strings.NewReader(body)).WithContext(ctx)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Composition-Job", id)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, request)
		cancel()
		return w
	}
	if w := submit(string(body)); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("job did not start")
	}
	if w := submit(string(body)); w.Code != 202 {
		t.Fatal(w.Code)
	}
	if w := submit(`{}`); w.Code != 409 {
		t.Fatal("reused ID accepted a different payload")
	}
	poll := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/compositions/"+id, nil))
		return w
	}
	if w := poll(); w.Code != 202 {
		t.Fatal("disconnected browser cancelled the job", w.Code)
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for {
		w := poll()
		if w.Code != 202 {
			if w.Code != 200 || !strings.Contains(w.Body.String(), `"scene"`) {
				t.Fatal(w.Code, w.Body.String())
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("job never completed")
		}
		time.Sleep(time.Millisecond)
	}
	if calls.Load() != 1 {
		t.Fatal("duplicate paid requests", calls.Load())
	}
	s.jobs.Lock()
	s.jobs.entries[id].created = time.Now().Add(-time.Hour)
	s.jobs.Unlock()
	if w := poll(); w.Code != 200 {
		t.Fatal("unread result lost on a later page visit")
	}
}

func TestExplicitJobCancellationAndExpiry(t *testing.T) {
	s := fixture()
	id := "12345678-1234-1234-1234-123456789abc"
	cancelled := false
	s.jobs.entries = map[string]*compositionJob{id: {created: time.Now(), cancel: func() { cancelled = true }}}
	h := s.routes()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("DELETE", "/api/v1/compositions/"+id, nil))
	if w.Code != 200 || !cancelled {
		t.Fatal("explicit stop did not cancel job")
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/compositions/"+id, nil))
	if w.Code != 409 {
		t.Fatal("cancelled job exposed a result")
	}
	s.jobs.entries[id].created = time.Now().Add(-time.Hour)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/compositions/"+id, nil))
	if w.Code != 404 {
		t.Fatal("expired result retained")
	}
}
