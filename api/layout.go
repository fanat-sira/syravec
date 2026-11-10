package main

import (
	"math"
	"sort"
	"strings"
)

const objectFactor = 1.0

type box struct{ x, y, w, h float64 }

func positiveMod(value, divisor int) int { return (value%divisor + divisor) % divisor }
func layoutPoints(preset string, n, seed int) [][2]float64 {
	p := [][2]float64{{.43, .57}, {.73, .3}, {.76, .74}, {.22, .24}, {.22, .77}, {.53, .2}, {.55, .83}}
	switch positiveMod(seed, 4) {
	case 1:
		p = [][2]float64{{.59, .52}, {.25, .3}, {.24, .75}, {.74, .78}, {.73, .2}, {.46, .81}, {.45, .19}}
	case 2:
		p = [][2]float64{{.47, .53}, {.21, .22}, {.77, .25}, {.78, .77}, {.25, .8}, {.52, .17}, {.52, .86}}
	case 3:
		p = [][2]float64{{.38, .55}, {.72, .52}, {.61, .21}, {.26, .79}, {.77, .79}, {.22, .22}, {.54, .82}}
	}
	if preset == "landscape" {
		p[0] = [2]float64{.44, .53}
		p[1] = [2]float64{.77, .43}
		p[2] = [2]float64{.16, .64}
		if seed%2 != 0 {
			p[0][0] = .57
			p[1][0] = .22
			p[2][0] = .83
		}
	}
	if preset == "portrait" {
		p[0] = [2]float64{.48, .5}
		p[1] = [2]float64{.66, .21}
		p[2] = [2]float64{.3, .8}
	}
	if n == 1 {
		return [][2]float64{{.5, .52}}
	}
	if n > 7 {
		cols := 3
		if preset == "landscape" {
			cols = 4
		}
		rows := int(math.Ceil(float64(n) / float64(cols)))
		p = nil
		for i := 0; i < n; i++ {
			p = append(p, [2]float64{(float64(i%cols) + .5) / float64(cols), (float64(i/cols) + .5) / float64(rows)})
		}
	}
	return p[:n]
}
func (s *Server) asset(id string) Asset {
	for _, a := range s.assets {
		if a.ID == id {
			return a
		}
	}
	return Asset{ViewBox: []float64{0, 0, 1, 1}}
}
func (s *Server) bounds(l Layer, c Canvas) box {
	a := s.asset(l.AssetID)
	rad := l.Rotation * math.Pi / 180
	k := objectFactor
	w := (math.Abs(a.ViewBox[2]*math.Cos(rad)) + math.Abs(a.ViewBox[3]*math.Sin(rad))) * k / float64(c.Width)
	h := (math.Abs(a.ViewBox[2]*math.Sin(rad)) + math.Abs(a.ViewBox[3]*math.Cos(rad))) * k / float64(c.Height)
	return box{l.X - w/2, l.Y - h/2, w, h}
}
func overlap(a, b box) float64 {
	w := math.Max(0, math.Min(a.x+a.w, b.x+b.w)-math.Max(a.x, b.x))
	h := math.Max(0, math.Min(a.y+a.h, b.y+b.h)-math.Max(a.y, b.y))
	return w * h / math.Max(1e-9, math.Min(a.w*a.h, b.w*b.h))
}

func (s *Server) alpha(l Layer, c Canvas, x, y float64) float64 {
	a := s.asset(l.AssetID)
	if len(a.Occupancy) != 64 {
		return 1
	}
	angle := l.Rotation * math.Pi / 180
	dx, dy := (x-l.X)*float64(c.Width), (y-l.Y)*float64(c.Height)
	k := objectFactor
	u := .5 + (dx*math.Cos(angle)+dy*math.Sin(angle))/(a.ViewBox[2]*k)
	v := .5 + (-dx*math.Sin(angle)+dy*math.Cos(angle))/(a.ViewBox[3]*k)
	if u < 0 || u >= 1 || v < 0 || v >= 1 {
		return 0
	}
	return a.Occupancy[int(v*8)*8+int(u*8)]
}
func (s *Server) inkOverlap(a, b Layer, c Canvas) float64 {
	aa, bb := s.bounds(a, c), s.bounds(b, c)
	if overlap(aa, bb) == 0 {
		return 0
	}
	if len(s.asset(a.AssetID).Occupancy) != 64 || len(s.asset(b.AssetID).Occupancy) != 64 {
		return overlap(aa, bb)
	}
	x0, y0 := math.Max(aa.x, bb.x), math.Max(aa.y, bb.y)
	w, h := math.Min(aa.x+aa.w, bb.x+bb.w)-x0, math.Min(aa.y+aa.h, bb.y+bb.h)-y0
	sum := 0.0
	for y := 0; y < 6; y++ {
		for x := 0; x < 6; x++ {
			px, py := x0+(float64(x)+.5)*w/6, y0+(float64(y)+.5)*h/6
			sum += s.alpha(a, c, px, py) * s.alpha(b, c, px, py)
		}
	}
	mass := func(l Layer) float64 {
		asset := s.asset(l.AssetID)
		density := 0.0
		for _, v := range asset.Occupancy {
			density += v / 64
		}
		k := objectFactor
		return asset.ViewBox[2] * asset.ViewBox[3] * k * k / float64(c.Width*c.Height) * density
	}
	return math.Min(1, w*h*sum/36/math.Max(1e-8, math.Min(mass(a), mass(b))))
}
func mainObject(l Layer) bool { return !strings.HasSuffix(l.AssetID, "-background") }
func (s *Server) layoutScore(sc Scene, original []Layer) float64 {
	score, mass, cx, cy := 0.0, 0.0, 0.0, 0.0
	for i, l := range sc.Layers {
		if !mainObject(l) {
			continue
		}
		base := original[i]
		importance := 1.0
		if base.Role == "focal" {
			importance = 2
		}
		score += importance * (math.Pow(l.X-base.X, 2) + math.Pow(l.Y-base.Y, 2)) * .65
		a := s.asset(l.AssetID)
		b := s.bounds(l, sc.Canvas)
		weight := a.VisualWeight
		if weight == 0 {
			weight = .6
		}
		m := b.w * b.h * weight
		px, py := l.X, l.Y
		if len(a.Centroid) == 2 {
			k := objectFactor
			dx, dy := (a.Centroid[0]-.5)*a.ViewBox[2]*k, (a.Centroid[1]-.5)*a.ViewBox[3]*k
			rad := l.Rotation * math.Pi / 180
			px += (dx*math.Cos(rad) - dy*math.Sin(rad)) / float64(sc.Canvas.Width)
			py += (dx*math.Sin(rad) + dy*math.Cos(rad)) / float64(sc.Canvas.Height)
		}
		mass += m
		cx += m * px
		cy += m * py
		for j := 0; j < i; j++ {
			if !mainObject(sc.Layers[j]) {
				continue
			}
			collision := s.inkOverlap(l, sc.Layers[j], sc.Canvas)
			score += math.Pow(math.Max(0, collision-.16), 2) * 20
		}
	}
	if mass > 0 {
		score += math.Pow(cx/mass-.5, 2)*2 + math.Pow(cy/mass-.53, 2)*2
	}
	return score
}
func (s *Server) refine(sc Scene) (Scene, []string) {
	sort.SliceStable(sc.Layers, func(i, j int) bool { return !mainObject(sc.Layers[i]) && mainObject(sc.Layers[j]) })
	original := append([]Layer(nil), sc.Layers...)
	order := []int{}
	for i, l := range sc.Layers {
		if mainObject(l) {
			order = append(order, i)
		}
	}
	sort.SliceStable(order, func(i, j int) bool { return sc.Layers[order[i]].Role == "focal" && sc.Layers[order[j]].Role != "focal" })
	offsets := [][2]float64{{0, 0}, {-.06, 0}, {.06, 0}, {0, -.06}, {0, .06}, {-.12, -.1}, {.12, -.1}, {-.12, .1}, {.12, .1}, {-.23, 0}, {.23, 0}, {0, -.23}, {0, .23}}
	for pass := 0; pass < 5; pass++ {
		changed := false
		for _, i := range order {
			current := sc.Layers[i]
			best := current
			score := s.layoutScore(sc, original)
			for _, offset := range offsets {
				candidate := current
				candidate.X += offset[0]
				candidate.Y += offset[1]
				candidate.X = math.Max(-.2, math.Min(1.2, candidate.X))
				candidate.Y = math.Max(-.2, math.Min(1.2, candidate.Y))
				sc.Layers[i] = candidate
				value := s.layoutScore(sc, original)
				if value+1e-8 < score {
					score = value
					best = candidate
				}
			}
			sc.Layers[i] = best
			if best.X != current.X || best.Y != current.Y {
				changed = true
			}
		}
		if !changed {
			break
		}
	}
	warnings := []string{}
	for i, a := range sc.Layers {
		if !mainObject(a) {
			continue
		}
		for _, b := range sc.Layers[:i] {
			if mainObject(b) && s.inkOverlap(a, b, sc.Canvas) > .4 {
				warnings = append(warnings, "плотная композиция, проверь перекрытия объектов")
				return sc, warnings
			}
		}
	}
	return sc, warnings
}
