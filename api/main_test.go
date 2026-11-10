package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func fixture() *Server {
	return &Server{assets: []Asset{{ID: "book-main", DisplayName: "Книга", Variant: "main", Tags: []string{"образование"}, ViewBox: []float64{0, 0, 1446, 977}}, {ID: "lamp-main", Variant: "main", ViewBox: []float64{0, 0, 946, 1129}}, {ID: "puzzle-main", Variant: "main", ViewBox: []float64{0, 0, 545, 314}}}, client: &http.Client{Timeout: time.Second}, slots: make(chan struct{}, 2)}
}
func req() Request {
	return Request{Mode: "selection", AssetIDs: []string{"book-main", "lamp-main"}, Palette: "violet", CanvasPreset: "square", Planner: "template"}
}
func call(s *Server, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/api/v1/compositions", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.routes().ServeHTTP(w, r)
	return w
}
func TestTemplate(t *testing.T) {
	s := fixture()
	r := req()
	p := s.template(r)
	if err := s.validatePlan(p, r); err != nil {
		t.Fatal(err)
	}
	for _, preset := range []string{"square", "landscape", "portrait"} {
		r.CanvasPreset = preset
		sc := s.scene(p, r)
		if len(sc.Layers) != 2 {
			t.Fatal("missing assets")
		}
		for _, l := range sc.Layers {
			if l.X < 0 || l.X > 1 || l.Y < 0 || l.Y > 1 || l.Scale <= 0 {
				t.Fatalf("bad geometry: %+v", l)
			}
		}
	}
}
func TestBadRequests(t *testing.T) {
	s := fixture()
	for _, b := range []string{`{}`, `{"unknown":true}`, `{} {}`, `{"mode":"selection","assetIds":["evil"],"palette":"violet","canvasPreset":"square","planner":"template"}`} {
		if w := call(s, b); w.Code != 400 {
			t.Fatalf("%s => %d", b, w.Code)
		}
	}
}
func TestSelectionContract(t *testing.T) {
	s := fixture()
	r := req()
	for _, p := range []Plan{{Items: []Item{{AssetID: "book-main", X: .5, Y: .5, RelativeSize: 1, Rotation: 0}}}, {Items: []Item{{AssetID: "book-main", X: .5, Y: .5, RelativeSize: 1, Rotation: 0}, {AssetID: "fake", X: .5, Y: .5, RelativeSize: 1, Rotation: 0}}}, {Items: []Item{{AssetID: "book-main", X: -100, Y: .5, RelativeSize: 1, Rotation: 0}, {AssetID: "lamp-main", X: .5, Y: .5, RelativeSize: 1, Rotation: 0}}}} {
		if s.validatePlan(p, r) == nil {
			t.Fatal("accepted invalid plan")
		}
	}
}
func TestEndpoint(t *testing.T) {
	s := fixture()
	b, _ := json.Marshal(req())
	w := call(s, string(b))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var out struct {
		Scene      Scene `json:"scene"`
		Generation struct {
			Source string `json:"source"`
		} `json:"generation"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.Generation.Source != "fallback" || len(out.Scene.Layers) != 2 {
		t.Fatal(w.Body.String())
	}
	r := req()
	r.Planner = "llm"
	r.Mode = "concept"
	r.Prompt = "идея иллюстрации"
	r.AssetIDs = nil
	b, _ = json.Marshal(r)
	if w = call(s, string(b)); w.Code != 503 {
		t.Fatal(w.Code)
	}
}
func TestProvider(t *testing.T) {
	for _, tc := range []struct {
		name, content string
		status        int
		want          bool
	}{{"valid", `{"items":[{"assetId":"book-main","preferredX":0.5,"preferredY":0.5,"relativeSize":1,"rotation":0},{"assetId":"lamp-main","preferredX":0.7,"preferredY":0.3,"relativeSize":1,"rotation":0}]}`, 200, true}, {"unknown", `{"items":[{"assetId":"fake"}]}`, 200, false}, {"malformed", `not json`, 200, false}, {"trailing", `{"items":[]} {}`, 200, false}, {"provider failure", "", 429, false}} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("wrong provider contract")
				}
				b, _ := io.ReadAll(r.Body)
				if !strings.Contains(string(b), "json_schema") {
					t.Error("missing schema")
				}
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": tc.content}}}})
			}))
			defer srv.Close()
			s := fixture()
			s.key = "test-key"
			s.url = srv.URL
			s.format = "json_schema"
			_, err := s.plan(context.Background(), req())
			if (err == nil) != tc.want {
				t.Fatalf("unexpected error %v", err)
			}
		})
	}
}
func TestCanceledProvider(t *testing.T) {
	s := fixture()
	s.url = "http://127.0.0.1:1"
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.plan(ctx, req()); err == nil {
		t.Fatal("ignored cancellation")
	}
}

func TestRefineReducesPileAndPreservesSelection(t *testing.T) {
	s := fixture()
	r := req()
	p := Plan{Items: []Item{{AssetID: "book-main", X: .5, Y: .5, RelativeSize: 1.5, Rotation: 0}, {AssetID: "lamp-main", X: .5, Y: .5, RelativeSize: 1.5, Rotation: 0}}}
	sc := s.scene(p, r)
	before := overlap(s.bounds(sc.Layers[0], sc.Canvas), s.bounds(sc.Layers[1], sc.Canvas))
	sc, _ = s.refine(sc)
	after := overlap(s.bounds(sc.Layers[0], sc.Canvas), s.bounds(sc.Layers[1], sc.Canvas))
	if after >= before {
		t.Fatalf("overlap did not improve: %f to %f", before, after)
	}
	if len(sc.Layers) != 2 {
		t.Fatal("lost selected items")
	}
}
