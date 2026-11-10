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
	illustrationSize := r.IllustrationSize
	if illustrationSize == "" {
		illustrationSize = "large"
	}
	assets := make([]Asset, 0, len(s.assets)+len(r.CustomAssets))
	for _, original := range s.assets {
		asset := original
		if geometry, ok := original.Sets[illustrationSize]; ok {
			asset.ViewBox = geometry.ViewBox
			asset.AssetURL = geometry.AssetURL
			asset.VisualBounds = geometry.VisualBounds
			asset.Occupancy = geometry.Occupancy
			asset.VisualWeight = geometry.VisualWeight
			asset.Centroid = geometry.Centroid
		} else if illustrationSize != "large" {
			return nil, errors.New("малый исходный набор не подготовлен")
		}
		assets = append(assets, asset)
	}
	if len(r.CustomAssets) > 0 && (r.Mode != "selection" || len(r.CustomAssets) > len(r.AssetIDs) || len(r.CustomAssets) > 40) {
		return nil, errors.New("неверные описания объектов")
	}
	requested := map[string]bool{}
	for _, id := range r.AssetIDs {
		requested[id] = true
	}
	seen := map[string]bool{}
	for _, a := range r.CustomAssets {
		nativeSize := a.IllustrationSize
		if nativeSize == "" {
			nativeSize = "large"
		}
		if nativeSize != illustrationSize {
			return nil, errors.New("у своего SVG нет альтернативной версии размера")
		}
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

func validateCatalog(assets []Asset) error {
	if len(assets) != 20 {
		return errors.New("нужны 20 логических объектов в обоих исходных наборах")
	}
	ids := map[string]bool{}
	for _, asset := range assets {
		if ids[asset.ID] {
			return errors.New("повторяющийся логический ID")
		}
		ids[asset.ID] = true
		for _, size := range []string{"large", "small"} {
			g, ok := asset.Sets[size]
			if !ok || len(g.ViewBox) != 4 || g.ViewBox[2] <= 0 || g.ViewBox[3] <= 0 || g.AssetURL == "" {
				return errors.New("неполный исходный набор SVG")
			}
			for _, v := range g.ViewBox {
				if math.IsNaN(v) || math.IsInf(v, 0) {
					return errors.New("неверные исходные размеры")
				}
			}
		}
		if asset.Sets["large"].AssetURL == asset.Sets["small"].AssetURL {
			return errors.New("для размеров нужны разные исходные SVG")
		}
	}
	return nil
}
