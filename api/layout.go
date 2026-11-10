package main

import (
	"math"
	"sort"
	"strings"
)

type box struct{ x, y, w, h float64 }

func (s *Server) bounds(l Layer, c Canvas) box {
	var a Asset
	for _, v := range s.assets {
		if v.ID == l.AssetID {
			a = v
			break
		}
	}
	rad := l.Rotation * math.Pi / 180
	k := .4 * float64(min(c.Width, c.Height)) / math.Max(a.ViewBox[2], a.ViewBox[3]) * l.Scale
	w := (math.Abs(a.ViewBox[2]*math.Cos(rad)) + math.Abs(a.ViewBox[3]*math.Sin(rad))) * k / float64(c.Width)
	h := (math.Abs(a.ViewBox[2]*math.Sin(rad)) + math.Abs(a.ViewBox[3]*math.Cos(rad))) * k / float64(c.Height)
	return box{l.X - w/2, l.Y - h/2, w, h}
}
func overlap(a, b box) float64 {
	w := math.Max(0, math.Min(a.x+a.w, b.x+b.w)-math.Max(a.x, b.x))
	h := math.Max(0, math.Min(a.y+a.h, b.y+b.h)-math.Max(a.y, b.y))
	return w * h / math.Min(a.w*a.h, b.w*b.h)
}

// AABB scoring is conservative for artwork with transparent space; mild overlap stays intentional
func (s *Server) refine(sc Scene) (Scene, []string) {
	sort.SliceStable(sc.Layers, func(i, j int) bool {
		return strings.HasSuffix(sc.Layers[i].AssetID, "-background") && !strings.HasSuffix(sc.Layers[j].AssetID, "-background")
	})
	placed := []box{}
	warnings := []string{}
	for i, l := range sc.Layers {
		if strings.HasSuffix(l.AssetID, "-background") {
			continue
		}
		best := l
		bestScore := math.Inf(1)
		b := s.bounds(l, sc.Canvas)
		for _, dy := range []float64{0, -.1, .1, -.2, .2} {
			for _, dx := range []float64{0, -.1, .1, -.2, .2} {
				candidate := l
				candidate.X = math.Max(b.w/2+.02, math.Min(1-b.w/2-.02, l.X+dx))
				candidate.Y = math.Max(b.h/2+.02, math.Min(1-b.h/2-.02, l.Y+dy))
				cb := s.bounds(candidate, sc.Canvas)
				score := math.Hypot(candidate.X-l.X, candidate.Y-l.Y) * .35
				for _, other := range placed {
					score += math.Max(0, overlap(cb, other)-.18) * 2
				}
				if score < bestScore {
					bestScore = score
					best = candidate
				}
			}
		}
		sc.Layers[i] = best
		bb := s.bounds(best, sc.Canvas)
		for _, other := range placed {
			if overlap(bb, other) > .55 {
				if len(warnings) == 0 {
					warnings = append(warnings, "объектов много, проверь перекрытия и при необходимости поправь слои вручную")
				}
				break
			}
		}
		placed = append(placed, bb)
	}
	return sc, warnings
}
