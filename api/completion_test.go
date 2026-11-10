package main

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
)

func realCatalog(t *testing.T) *Server {
	t.Helper()
	s := fixture()
	raw, err := os.ReadFile("../web/public/assets/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Assets []Asset `json:"assets"`
	}
	if err = json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	s.assets = m.Assets
	return s
}
func TestCatalogShapeMetadata(t *testing.T) {
	s := realCatalog(t)
	if len(s.assets) != 20 {
		t.Fatal("missing variants")
	}
	for _, a := range s.assets {
		if a.Description == "" || len(a.Occupancy) != 64 || a.VisualWeight <= 0 || len(a.VisualBounds) != 4 || len(a.Centroid) != 2 {
			t.Fatalf("unmeasured asset %s", a.ID)
		}
		if a.Variant == "main" {
			b := s.asset(strings.TrimSuffix(a.ID, "-main") + "-background")
			if !reflect.DeepEqual(a.ViewBox, b.ViewBox) {
				t.Fatal("paired geometry dimensions differ")
			}
		}
	}
}
func TestCompositionMatrix(t *testing.T) {
	s := realCatalog(t)
	selections := [][]string{{"book-main", "phone-main", "puzzle-main"}, {"lamp-main", "flowers-background"}, {"coin-main", "wallet-main", "folder-background"}, {"pen-main"}, {"book-background", "phone-background", "puzzle-background"}, {"book-main", "phone-main", "puzzle-main", "lamp-main", "wallet-main", "coin-main", "headphones-main", "folder-main", "pen-main", "flowers-main"}}
	for _, ids := range selections {
		for _, preset := range []string{"square", "landscape", "portrait"} {
			for seed := 0; seed < 4; seed++ {
				r := req()
				r.AssetIDs = ids
				r.CanvasPreset = preset
				r.Seed = seed
				p := s.template(r)
				if err := s.validatePlan(p, r); err != nil {
					t.Fatal(err)
				}
				sc, _ := s.refine(s.scene(p, r))
				found := map[string]int{}
				for _, l := range sc.Layers {
					found[l.AssetID]++
					b := s.bounds(l, sc.Canvas)
					if b.x < -.001 || b.y < -.001 || b.x+b.w > 1.001 || b.y+b.h > 1.001 {
						t.Fatalf("clipped %s %s: %+v", preset, l.AssetID, b)
					}
					if math.IsNaN(l.Scale) || l.Scale < .1 {
						t.Fatal("invalid scale")
					}
				}
				for _, id := range ids {
					if found[id] != 1 {
						t.Fatal("selected asset mismatch")
					}
				}
			}
		}
	}
}
func TestAlternativesDiffer(t *testing.T) {
	s := realCatalog(t)
	a := req()
	a.AssetIDs = []string{"book-main", "coin-main", "lamp-main"}
	b := a
	b.Seed = 1
	sa, _ := s.refine(s.scene(s.template(a), a))
	sb, _ := s.refine(s.scene(s.template(b), b))
	same := true
	for i := range sa.Layers {
		same = same && math.Abs(sa.Layers[i].X-sb.Layers[i].X) < .01 && math.Abs(sa.Layers[i].Y-sb.Layers[i].Y) < .01
	}
	if same {
		t.Fatal("no meaningful alternative layout")
	}
}
func TestNormalizerRepairsFiniteOutOfFramePlan(t *testing.T) {
	s := realCatalog(t)
	r := req()
	r.AssetIDs = []string{"book-main", "lamp-main"}
	p := Plan{Items: []Item{{AssetID: "book-main", X: -.4, Y: 1.7, RelativeSize: 8, Rotation: 395, Role: "focal", Depth: 2}, {AssetID: "lamp-main", X: 1.8, Y: -.1, RelativeSize: 4, Rotation: -70, Role: "support", Depth: 1}}}
	if err := s.validatePlan(p, r); err != nil {
		t.Fatal(err)
	}
	sc, _ := s.refine(s.scene(p, r))
	if sc.Layers[0].AssetID != "lamp-main" {
		t.Fatal("model depth order lost")
	}
	for _, l := range sc.Layers {
		b := s.bounds(l, sc.Canvas)
		if b.x < 0 || b.y < 0 || b.x+b.w > 1 || b.y+b.h > 1 {
			t.Fatal("failed normalization")
		}
	}
}
func TestStructuredPromptAndBoundedRepair(t *testing.T) {
	s := realCatalog(t)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		encoded, _ := json.Marshal(payload)
		for _, text := range []string{"knowledge", "visualWeight", "require_parameters", "role", "depth", "opacity", "variationId"} {
			if !strings.Contains(string(encoded), text) {
				t.Errorf("missing semantic or structured contract: %s", text)
			}
		}
		content := `{"items":[{"assetId":"invented","relativeSize":1}]}`
		if calls == 2 {
			content = `{"concept":"knowledge connects people","layout":"diagonal","items":[{"assetId":"book-main","role":"focal","preferredX":0.45,"preferredY":0.6,"relativeSize":1.9,"rotation":-6,"depth":1,"opacity":1},{"assetId":"phone-main","role":"support","preferredX":0.75,"preferredY":0.3,"relativeSize":1,"rotation":4,"depth":2,"opacity":1}]}`
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}, "finish_reason": "stop"}}})
	}))
	defer srv.Close()
	s.url = srv.URL
	s.key = "test-only"
	s.format = "json_schema"
	r := req()
	r.Mode = "concept"
	r.Prompt = "знания соединяют людей"
	r.AssetIDs = nil
	p, err := s.plan(context.Background(), r)
	if err != nil || calls != 2 || len(p.Items) != 2 {
		t.Fatalf("repair failed: %v, %d calls", err, calls)
	}
}
func TestPaidProviderFailureNeverBecomesTemplate(t *testing.T) {
	s := realCatalog(t)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(429) }))
	defer srv.Close()
	s.url = srv.URL
	s.key = "test-only"
	r := req()
	r.Planner = "llm"
	data, _ := json.Marshal(r)
	w := call(s, string(data))
	if w.Code != 429 || calls != 1 {
		t.Fatalf("silent fallback or unbounded retry: %d %d %s", w.Code, calls, w.Body.String())
	}
}
func TestSelectionRejectsAnyExtraOrMissingAsset(t *testing.T) {
	s := realCatalog(t)
	r := req()
	r.AssetIDs = []string{"book-background", "phone-main"}
	for _, ids := range [][]string{{"book-background"}, {"book-background", "phone-main", "coin-main"}, {"book-background", "phone-main", "phone-main"}} {
		p := Plan{}
		for _, id := range ids {
			p.Items = append(p.Items, Item{AssetID: id, X: .5, Y: .5, RelativeSize: 1})
		}
		if err := s.validatePlan(p, r); err == nil {
			t.Fatal("invalid selection accepted")
		}
	}
}

func TestConfiguredKeyMakesLLMTheDefault(t *testing.T) {
	s := realCatalog(t)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		content := `{"concept":"focused learning","layout":"diagonal","items":[{"assetId":"book-main","role":"focal","preferredX":0.45,"preferredY":0.55,"relativeSize":1.7,"rotation":-4,"depth":1,"opacity":1},{"assetId":"lamp-main","role":"support","preferredX":0.75,"preferredY":0.25,"relativeSize":1,"rotation":0,"depth":2,"opacity":1}]}`
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}}}})
	}))
	defer upstream.Close()
	s.url, s.key, s.format = upstream.URL, "test-only", "json_schema"
	r := req()
	r.Planner = ""
	r.Palette = "custom"
	r.PaletteColors = map[string]string{"strong": "#123456", "medium": "#334455", "light": "#ddeeff", "highlight": "#ffeedd", "pink": "#ffaabb", "soft": "#ffeef0"}
	data, _ := json.Marshal(r)
	w := call(s, string(data))
	if w.Code != 200 || calls != 1 || !strings.Contains(w.Body.String(), `"source":"llm"`) {
		t.Fatalf("configured provider was not the default: %d %s", w.Code, w.Body.String())
	}
	r.PaletteColors["light"] = "url(https://invalid)"
	data, _ = json.Marshal(r)
	if w := call(s, string(data)); w.Code != 400 || calls != 1 {
		t.Fatal("invalid palette reached provider")
	}
}
