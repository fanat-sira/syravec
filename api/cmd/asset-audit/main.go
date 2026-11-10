// asset-audit measures the supplied vectors without changing their geometry.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	root := os.Getenv("ASSET_PUBLIC_ROOT")
	if root == "" {
		root = "../web/public"
	}
	file := filepath.Join(root, "assets/manifest.json")
	raw, err := os.ReadFile(file)
	if err != nil {
		panic(err)
	}
	var manifest map[string]any
	if err = json.Unmarshal(raw, &manifest); err != nil {
		panic(err)
	}
	for _, entry := range manifest["assets"].([]any) {
		a := entry.(map[string]any)
		if sets, ok := a["sets"].(map[string]any); ok {
			for _, size := range []string{"large", "small"} {
				measure(root, sets[size].(map[string]any))
			}
			for key, value := range sets["large"].(map[string]any) {
				a[key] = value
			}
		} else {
			measure(root, a)
		}
	}
	out, _ := json.MarshalIndent(manifest, "", "  ")
	if err = os.WriteFile(file, append(out, '\n'), 0644); err != nil {
		panic(err)
	}
	fmt.Println("measured original vector sets, bounds and visual weights")
}
func measure(root string, a map[string]any) {
	path := filepath.Join(root, a["assetUrl"].(string))
	data, err := exec.Command("rsvg-convert", "-w", "128", path).Output()
	if err != nil {
		panic(err)
	}
	im, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		panic(err)
	}
	b := im.Bounds()
	w, h := b.Dx(), b.Dy()
	cells := make([]float64, 64)
	counts := make([]float64, 64)
	minX, minY, maxX, maxY := w, h, 0, 0
	mass, cx, cy := 0.0, 0.0, 0.0
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, bl, alpha := im.At(x+b.Min.X, y+b.Min.Y).RGBA()
			v := float64(alpha) / 65535
			cell := min(7, y*8/h)*8 + min(7, x*8/w)
			cells[cell] += v
			counts[cell]++
			if alpha > 2048 {
				minX = min(minX, x)
				minY = min(minY, y)
				maxX = max(maxX, x)
				maxY = max(maxY, y)
			}
			contrast := v * .35
			if alpha > 0 {
				lum := (.2126*float64(r) + .7152*float64(g) + .0722*float64(bl)) / float64(alpha)
				contrast = v * (.35 + .65*(1-lum))
			}
			mass += contrast
			cx += (float64(x) + .5) / float64(w) * contrast
			cy += (float64(y) + .5) / float64(h) * contrast
		}
	}
	if mass == 0 {
		panic("empty asset")
	}
	for i := range cells {
		cells[i] = math.Round(cells[i]/math.Max(1, counts[i])*1000) / 1000
	}
	a["occupancy"] = cells
	a["visualBounds"] = []float64{float64(minX) / float64(w), float64(minY) / float64(h), float64(maxX-minX+1) / float64(w), float64(maxY-minY+1) / float64(h)}
	a["visualWeight"] = mass / float64(w*h)
	a["centroid"] = []float64{cx / mass, cy / mass}
}
