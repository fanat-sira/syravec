package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type Asset struct {
	ID           string    `json:"id"`
	DisplayName  string    `json:"displayName"`
	Variant      string    `json:"variant"`
	Tags         []string  `json:"tags"`
	ViewBox      []float64 `json:"viewBox"`
	AssetURL     string    `json:"assetUrl"`
	Description  string    `json:"description"`
	VisualBounds []float64 `json:"visualBounds,omitempty"`
	Occupancy    []float64 `json:"occupancy,omitempty"`
	VisualWeight float64   `json:"visualWeight,omitempty"`
	Centroid     []float64 `json:"centroid,omitempty"`
}
type Canvas struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Preset string `json:"preset"`
}
type Layer struct {
	ID       string  `json:"id"`
	AssetID  string  `json:"assetId"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Scale    float64 `json:"scale"`
	Rotation float64 `json:"rotation"`
	Opacity  float64 `json:"opacity"`
	Visible  bool    `json:"visible"`
	Locked   bool    `json:"locked"`
	Role     string  `json:"role,omitempty"`
}
type Scene struct {
	Version      int     `json:"version"`
	Canvas       Canvas  `json:"canvas"`
	Palette      string  `json:"palette"`
	BackgroundID string  `json:"backgroundId"`
	Layers       []Layer `json:"layers"`
}
type Request struct {
	Mode          string            `json:"mode"`
	Prompt        string            `json:"prompt"`
	AssetIDs      []string          `json:"assetIds"`
	Palette       string            `json:"palette"`
	CanvasPreset  string            `json:"canvasPreset"`
	Seed          int               `json:"seed"`
	Planner       string            `json:"planner"`
	PaletteColors map[string]string `json:"paletteColors,omitempty"`
}
type Item struct {
	AssetID      string   `json:"assetId"`
	X            float64  `json:"preferredX"`
	Y            float64  `json:"preferredY"`
	RelativeSize float64  `json:"relativeSize"`
	Rotation     float64  `json:"rotation"`
	Role         string   `json:"role"`
	Depth        int      `json:"depth"`
	Opacity      *float64 `json:"opacity,omitempty"`
}
type Plan struct {
	Items   []Item `json:"items"`
	Concept string `json:"concept"`
	Layout  string `json:"layout"`
}
type Server struct {
	assets                  []Asset
	manifest                json.RawMessage
	key, model, url, format string
	client                  *http.Client
	slots                   chan struct{}
	mu                      sync.Mutex
	calls                   []time.Time
}

func env(k, d string) string {
	if s := os.Getenv(k); s != "" {
		return s
	}
	return d
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	respond(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func (s *Server) validate(r Request) error {
	if r.Mode != "concept" && r.Mode != "selection" {
		return errors.New("неизвестный режим")
	}
	if len([]rune(r.Prompt)) > 2000 {
		return errors.New("запрос длиннее 2000 символов")
	}
	if r.Mode == "concept" && strings.TrimSpace(r.Prompt) == "" {
		return errors.New("добавь описание композиции")
	}
	if r.Palette != "violet" && r.Palette != "teal" && r.Palette != "warm" && r.Palette != "custom" {
		return errors.New("неизвестная палитра")
	}
	if r.CanvasPreset != "square" && r.CanvasPreset != "landscape" && r.CanvasPreset != "portrait" {
		return errors.New("неизвестный формат")
	}
	if r.Planner != "" && r.Planner != "llm" && r.Planner != "template" {
		return errors.New("неизвестный способ сборки")
	}
	if len(r.AssetIDs) > 12 || r.Mode == "selection" && len(r.AssetIDs) == 0 {
		return errors.New("выбери от 1 до 12 объектов")
	}
	for key, value := range r.PaletteColors {
		if !strings.Contains(" strong medium light highlight pink soft ", " "+key+" ") || len(value) != 7 || value[0] != '#' {
			return errors.New("неверный цвет палитры")
		}
		if _, err := hex.DecodeString(value[1:]); err != nil {
			return errors.New("неверный цвет палитры")
		}
	}
	seen := map[string]bool{}
	for _, id := range r.AssetIDs {
		if !s.has(id) || seen[id] {
			return errors.New("неизвестный или повторяющийся объект")
		}
		seen[id] = true
	}
	return nil
}
func (s *Server) has(id string) bool {
	for _, a := range s.assets {
		if a.ID == id {
			return true
		}
	}
	return false
}
func (s *Server) validatePlan(p Plan, r Request) error {
	if len(p.Items) < 1 || len(p.Items) > 12 {
		return errors.New("неверное число объектов")
	}
	found := map[string]bool{}
	required := map[string]bool{}
	for _, id := range r.AssetIDs {
		required[id] = true
	}
	for _, i := range p.Items {
		if !s.has(i.AssetID) {
			return errors.New("модель выбрала неизвестный объект")
		}
		if r.Mode == "selection" && !required[i.AssetID] {
			return errors.New("модель добавила лишний объект")
		}
		if found[i.AssetID] && r.Mode == "selection" {
			return errors.New("модель повторила объект")
		}
		if i.Role != "" && i.Role != "focal" && i.Role != "support" && i.Role != "decor" {
			return errors.New("неизвестная роль объекта")
		}
		if i.Opacity != nil && (math.IsNaN(*i.Opacity) || math.IsInf(*i.Opacity, 0) || *i.Opacity < 0 || *i.Opacity > 1) {
			return errors.New("неверная прозрачность")
		}
		found[i.AssetID] = true
		for _, v := range []float64{i.X, i.Y, i.RelativeSize, i.Rotation} {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return errors.New("неверные координаты")
			}
		}
		if math.Abs(i.X) > 5 || math.Abs(i.Y) > 5 || i.RelativeSize <= 0 || i.RelativeSize > 12 || math.Abs(i.Rotation) > 3600 {
			return errors.New("координаты вне допустимых границ")
		}
	}
	if r.Mode == "concept" {
		mainCount := 0
		for _, item := range p.Items {
			if !strings.HasSuffix(item.AssetID, "-background") {
				mainCount++
			}
		}
		if mainCount == 0 {
			return errors.New("для идеи нужен хотя бы один главный объект")
		}
	}
	if r.Mode == "selection" {
		for id := range required {
			if !found[id] {
				return errors.New("модель пропустила выбранный объект")
			}
		}
	}
	return nil
}
func (s *Server) template(r Request) Plan {
	ids := r.AssetIDs
	if r.Mode == "concept" {
		type hit struct {
			id    string
			score int
		}
		hits := []hit{}
		q := strings.ToLower(r.Prompt)
		for _, a := range s.assets {
			if a.Variant != "main" {
				continue
			}
			score := 0
			if strings.Contains(q, strings.ToLower(a.DisplayName)) {
				score += 5
			}
			for _, tag := range a.Tags {
				stem := []rune(tag)
				if len(stem) > 4 {
					stem = stem[:len(stem)-2]
				}
				if strings.Contains(q, string(stem)) {
					score++
				}
			}
			if score > 0 {
				hits = append(hits, hit{a.ID, score})
			}
		}
		for i := 0; i < len(hits); i++ {
			for j := i + 1; j < len(hits); j++ {
				if hits[j].score > hits[i].score {
					hits[i], hits[j] = hits[j], hits[i]
				}
			}
		}
		ids = []string{}
		for _, h := range hits {
			if len(ids) < 4 {
				ids = append(ids, h.id)
			}
		}
		if len(ids) == 0 {
			ids = []string{"book-main", "puzzle-main", "lamp-main"}
		}
	}
	p := Plan{Concept: "шаблонная компоновка", Layout: []string{"diagonal", "cluster", "arc", "editorial"}[positiveMod(r.Seed, 4)]}
	points := layoutPoints(r.CanvasPreset, len(ids), r.Seed)
	focalAssigned := false
	for i, id := range ids {
		role := "support"
		size := 1.05
		if strings.HasSuffix(id, "-background") {
			role = "decor"
			size = 1.6
		} else if !focalAssigned {
			role = "focal"
			size = 1.9
			focalAssigned = true
		}
		if len(ids) > 5 {
			size *= math.Sqrt(5 / float64(len(ids)))
		}
		p.Items = append(p.Items, Item{AssetID: id, X: points[i][0], Y: points[i][1], RelativeSize: size, Rotation: float64(positiveMod(i+r.Seed, 5)-2) * 5, Role: role, Depth: i})
	}

	return p
}
func (s *Server) scene(p Plan, r Request) Scene {
	c := Canvas{1000, 1000, r.CanvasPreset}
	if c.Preset == "landscape" {
		c.Height = 633
	}
	if c.Preset == "portrait" {
		c.Width = 750
	}
	bg := "background-" + c.Preset + "-" + r.Palette
	if c.Preset == "portrait" || r.Palette == "custom" {
		bg = ""
	}
	sc := Scene{1, c, r.Palette, bg, []Layer{}}
	items := append([]Item(nil), p.Items...)
	sort.SliceStable(items, func(i, j int) bool {
		bi, bj := strings.HasSuffix(items[i].AssetID, "-background"), strings.HasSuffix(items[j].AssetID, "-background")
		if bi != bj {
			return bi
		}
		return items[i].Depth < items[j].Depth
	})
	hasFocal := false
	largest := -1
	largestSize := 0.0
	for i, item := range items {
		if strings.HasSuffix(item.AssetID, "-background") {
			items[i].Role = "decor"
			continue
		}
		if item.Role == "focal" {
			hasFocal = true
		}
		if !strings.HasSuffix(item.AssetID, "-background") && item.RelativeSize > largestSize {
			largest = i
			largestSize = item.RelativeSize
		}
	}
	if !hasFocal && largest >= 0 {
		items[largest].Role = "focal"
	}
	for i, item := range items {
		var a Asset
		for _, v := range s.assets {
			if v.ID == item.AssetID {
				a = v
				break
			}
		}
		vw, vh := a.ViewBox[2], a.ViewBox[3]
		scale := math.Max(.2, math.Min(6, item.RelativeSize))
		opacity := 1.0
		if strings.HasSuffix(item.AssetID, "-background") {
			opacity = .6
		}
		if item.Opacity != nil {
			opacity = math.Max(.2, math.Min(1, *item.Opacity))
			if !strings.HasSuffix(item.AssetID, "-background") {
				opacity = math.Max(.65, opacity)
			}
		}
		// rotated conservative bounds; reduce an oversized proposal, then keep it inside the frame
		rad := item.Rotation * math.Pi / 180
		k := .4 * float64(min(c.Width, c.Height)) / math.Max(vw, vh)
		rw := (math.Abs(vw*math.Cos(rad)) + math.Abs(vh*math.Sin(rad))) * k
		rh := (math.Abs(vw*math.Sin(rad)) + math.Abs(vh*math.Cos(rad))) * k
		scale = math.Min(scale, math.Min(float64(c.Width)*.9/rw, float64(c.Height)*.9/rh))
		mx, my := rw*scale/2/float64(c.Width), rh*scale/2/float64(c.Height)
		x, y := math.Max(mx+.02, math.Min(1-mx-.02, item.X)), math.Max(my+.02, math.Min(1-my-.02, item.Y))
		role := item.Role
		if role == "" {
			role = "support"
		}
		if role == "focal" && len(items) <= 5 {
			scale = math.Max(scale, 1.45)
		}
		sc.Layers = append(sc.Layers, s.fit(Layer{ID: fmt.Sprintf("layer-%d-%d", r.Seed, i), AssetID: item.AssetID, X: x, Y: y, Scale: scale, Rotation: math.Mod(item.Rotation, 360), Opacity: opacity, Visible: true, Locked: false, Role: role}, c))
	}
	return sc
}
func (s *Server) compose(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "invalid_request", "нужен application/json")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	var input Request
	err := d.Decode(&input)
	if err == nil {
		var extra any
		if d.Decode(&extra) != io.EOF {
			err = errors.New("лишние данные после json")
		}
	}
	if err == nil {
		err = s.validate(input)
	}
	if err != nil {
		fail(w, 400, "invalid_request", "проверь запрос: "+err.Error())
		return
	}
	if input.Planner == "" {
		if s.key != "" {
			input.Planner = "llm"
		} else {
			input.Planner = "template"
		}
	}
	var p Plan
	source := "fallback"
	warnings := []string{}
	if input.Planner == "template" {
		p = s.template(input)
		warnings = append(warnings, "шаблонная раскладка, без ai")
	} else {
		if s.key == "" {
			fail(w, 503, "not_configured", "ai пока не подключен, попробуй шаблонную сборку")
			return
		}
		s.mu.Lock()
		now := time.Now()
		recent := s.calls[:0]
		for _, t := range s.calls {
			if now.Sub(t) < time.Minute {
				recent = append(recent, t)
			}
		}
		s.calls = recent
		if len(recent) >= 10 {
			s.mu.Unlock()
			fail(w, 429, "rate_limited", "слишком много запросов, подожди минуту")
			return
		}
		s.calls = append(s.calls, now)
		s.mu.Unlock()
		select {
		case s.slots <- struct{}{}:
			defer func() { <-s.slots }()
		default:
			fail(w, 429, "rate_limited", "сервис занят, попробуй позже")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		p, err = s.plan(ctx, input)
		if err != nil {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				fail(w, 504, "provider_timeout", "модель не ответила вовремя, композиция сохранена")
			} else if upstream := (providerError{}); errors.As(err, &upstream) && upstream.status == 429 {
				fail(w, 429, "rate_limited", "лимит провайдера исчерпан, попробуй позже")
			} else {
				log.Printf("planner failed: %T", err)
				fail(w, 502, "provider_error", "не удалось получить корректную композицию, попробуй еще раз или выбери шаблон")
			}
			return
		}
		source = "llm"
	}
	sc, layoutWarnings := s.refine(s.scene(p, input))
	warnings = append(warnings, layoutWarnings...)
	respond(w, 200, map[string]any{"scene": sc, "generation": map[string]any{"mode": input.Mode, "source": source, "warnings": warnings, "concept": p.Concept, "layout": p.Layout}})
}
func (s *Server) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"status": "ok", "aiConfigured": s.key != "", "model": s.model})
	})
	m.HandleFunc("GET /api/v1/catalog", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, s.manifest) })
	m.HandleFunc("POST /api/v1/compositions", s.compose)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		m.ServeHTTP(w, r)
	})
}
func main() {
	loadEnvironment()
	raw, err := os.ReadFile(env("CATALOG_PATH", "../web/public/assets/manifest.json"))
	if err != nil {
		log.Fatal(err)
	}
	var c struct {
		Assets []Asset `json:"assets"`
	}
	if err = json.Unmarshal(raw, &c); err != nil {
		log.Fatal(err)
	}
	s := &Server{assets: c.Assets, manifest: raw, key: os.Getenv("OPENROUTER_API_KEY"), model: env("AI_MODEL", "openai/gpt-4.1-mini"), url: strings.TrimRight(env("AI_BASE_URL", "https://openrouter.ai/api/v1"), "/"), format: env("AI_RESPONSE_FORMAT", "json_schema"), client: &http.Client{Timeout: 48 * time.Second}, slots: make(chan struct{}, 2)}
	srv := &http.Server{Addr: env("LISTEN_ADDR", "127.0.0.1:8080"), Handler: s.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 55 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("api listening on %s; ai configured: %v", srv.Addr, s.key != "")
	log.Fatal(srv.ListenAndServe())
}
