package main

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestSourceSetFixedDimensionsAndRatios(t *testing.T) {
	s := fixture()
	s.assets[0].Sets = map[string]AssetGeometry{"large": {ViewBox: []float64{0, 0, 1446, 977}}, "small": {ViewBox: []float64{0, 0, 723, 489}}}
	for i := 1; i < len(s.assets); i++ {
		v := s.assets[i].ViewBox
		s.assets[i].Sets = map[string]AssetGeometry{"large": {ViewBox: v}, "small": {ViewBox: []float64{0, 0, math.Ceil(v[2] / 2), math.Ceil(v[3] / 2)}}}
	}
	for _, size := range []string{"large", "small"} {
		input := req()
		input.IllustrationSize = size
		active, err := s.forRequest(input)
		if err != nil {
			t.Fatal(err)
		}
		scene := active.scene(active.template(input), input)
		before := active.bounds(scene.Layers[0], scene.Canvas)
		refined, _ := active.refine(scene)
		after := active.bounds(refined.Layers[0], scene.Canvas)
		if before.w != after.w || before.h != after.h {
			t.Fatal("optimizer changed native object dimensions")
		}
		raw, _ := json.Marshal(refined)
		if strings.Contains(string(raw), `"scale"`) {
			t.Fatal("layer scale leaked")
		}
		want := 1446.0
		if size == "small" {
			want = 723
		}
		if active.assets[0].ViewBox[2] != want {
			t.Fatal("source set not switched")
		}
	}
}
func TestExactCanvasDimensions(t *testing.T) {
	for _, tc := range []struct {
		preset, size string
		w, h         int
	}{{"square", "large", 1000, 1000}, {"square", "small", 500, 500}, {"landscape", "large", 1000, 633}, {"landscape", "small", 500, 317}, {"portrait", "large", 750, 1000}, {"portrait", "small", 375, 500}} {
		c := canvasFor(tc.preset, tc.size)
		if c.Width != tc.w || c.Height != tc.h {
			t.Fatalf("%+v => %+v", tc, c)
		}
	}
}
func TestModelContractRejectsLegacyIndividualSizes(t *testing.T) {
	s := fixture()
	input := req()
	input.Planner = "template"
	raw, _ := json.Marshal(input)
	bad := strings.TrimSuffix(string(raw), "}") + `,"scale":0.1}`
	if response := call(s, bad); response.Code != 400 {
		t.Fatal("hidden input scale allowed")
	}
	// Item's decoder rejects removed relativeSize; ordinary JSON unmarshalling is
	// not the provider contract, whose DisallowUnknownFields enforces this.
	decoder := json.NewDecoder(strings.NewReader(`{"assetId":"book-main","relativeSize":1}`))
	decoder.DisallowUnknownFields()
	var item Item
	if decoder.Decode(&item) == nil {
		t.Fatal("legacy per-item size accepted")
	}
}
