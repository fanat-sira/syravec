package main

import (
	"errors"
	"math"
	"strings"
)

func planItemLimit(r Request) int {
	if r.Mode == "selection" {
		return len(r.AssetIDs)
	}
	return 12
}

// Extra descriptors are request-local: no SVG markup, file paths or shared
// catalog mutation. All quota state continues to belong to the root server.
func (s *Server) forRequest(r Request) (*Server, error) {
	if len(r.CustomAssets) == 0 {
		return s, nil
	}
	if r.Mode != "selection" || len(r.CustomAssets) > len(r.AssetIDs) || len(r.CustomAssets) > 40 {
		return nil, errors.New("неверные описания объектов")
	}
	assets := append([]Asset(nil), s.assets...)
	requested := map[string]bool{}
	for _, id := range r.AssetIDs {
		requested[id] = true
	}
	seen := map[string]bool{}
	for _, a := range r.CustomAssets {
		if !strings.HasPrefix(a.ID, "custom-") || len(a.ID) > 256 || seen[a.ID] || s.has(a.ID) || !requested[a.ID] || len([]rune(a.DisplayName)) > 200 || len(a.ViewBox) != 4 {
			return nil, errors.New("неверное описание SVG")
		}
		for _, v := range a.ViewBox {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return nil, errors.New("неверный viewBox")
			}
		}
		if a.ViewBox[2] <= 0 || a.ViewBox[3] <= 0 || math.IsInf(a.ViewBox[2]/a.ViewBox[3], 0) || a.ViewBox[2]/a.ViewBox[3] == 0 {
			return nil, errors.New("неверные пропорции SVG")
		}
		seen[a.ID] = true
		assets = append(assets, Asset{ID: a.ID, DisplayName: a.DisplayName, Variant: "main", ViewBox: a.ViewBox, Description: "User-supplied vector object: " + a.DisplayName, VisualWeight: 1, Centroid: []float64{.5, .5}})
	}
	return &Server{assets: assets, key: s.key, model: s.model, url: s.url, format: s.format, client: s.client, quotaOwner: s}, nil
}
