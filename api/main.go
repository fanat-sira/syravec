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
	"strconv"
	"strings"
	"sync"
	"time"
)

type AssetGeometry struct {
	ViewBox      []float64 `json:"viewBox"`
	AssetURL     string    `json:"assetUrl"`
	VisualBounds []float64 `json:"visualBounds,omitempty"`
	Occupancy    []float64 `json:"occupancy,omitempty"`
	VisualWeight float64   `json:"visualWeight,omitempty"`
	Centroid     []float64 `json:"centroid,omitempty"`
}
type Asset struct {
	Sets         map[string]AssetGeometry `json:"sets,omitempty"`
	ID           string                   `json:"id"`
	DisplayName  string                   `json:"displayName"`
	Variant      string                   `json:"variant"`
	Tags         []string                 `json:"tags"`
	ViewBox      []float64                `json:"viewBox"`
	AssetURL     string                   `json:"assetUrl"`
	Description  string                   `json:"description"`
	VisualBounds []float64                `json:"visualBounds,omitempty"`
	Occupancy    []float64                `json:"occupancy,omitempty"`
	VisualWeight float64                  `json:"visualWeight,omitempty"`
	Centroid     []float64                `json:"centroid,omitempty"`
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
	Rotation float64 `json:"rotation"`
	Opacity  float64 `json:"opacity"`
	Visible  bool    `json:"visible"`
	Locked   bool    `json:"locked"`
	Role     string  `json:"role,omitempty"`
}
type Scene struct {
	IllustrationSize string  `json:"illustrationSize"`
	Version          int     `json:"version"`
	Canvas           Canvas  `json:"canvas"`
	Palette          string  `json:"palette"`
	BackgroundID     string  `json:"backgroundId"`
	Layers           []Layer `json:"layers"`
}
type CustomAssetDescriptor struct {
	IllustrationSize string    `json:"illustrationSize"`
	ID               string    `json:"id"`
	DisplayName      string    `json:"displayName"`
	ViewBox          []float64 `json:"viewBox"`
}
type Request struct {
	IllustrationSize string                  `json:"illustrationSize"`
	CustomAssets     []CustomAssetDescriptor `json:"customAssets,omitempty"`
	Mode             string                  `json:"mode"`
	Prompt           string                  `json:"prompt"`
	AssetIDs         []string                `json:"assetIds"`
	Palette          string                  `json:"palette"`
	CanvasPreset     string                  `json:"canvasPreset"`
	Seed             int                     `json:"seed"`
	Planner          string                  `json:"planner"`
	PaletteColors    map[string]string       `json:"paletteColors,omitempty"`
}
type Item struct {
	AssetID  string   `json:"assetId"`
	X        float64  `json:"preferredX"`
	Y        float64  `json:"preferredY"`
	Rotation float64  `json:"rotation"`
	Role     string   `json:"role"`
	Depth    int      `json:"depth"`
	Opacity  *float64 `json:"opacity,omitempty"`
}
type Plan struct {
	Items   []Item `json:"items"`
	Concept string `json:"concept"`
	Layout  string `json:"layout"`
}
type Server struct {
	jobs                    compositionJobs
	assets                  []Asset
	manifest                json.RawMessage
	key, model, url, format string
	client                  *http.Client
	slots                   chan struct{}
	mu                      sync.Mutex
	calls                   []time.Time
	ipCalls                 map[string][]time.Time
	usagePath               string
	trustProxy              bool
	aiLimits                aiQuotaLimits
	quotaOwner              *Server
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
	if r.IllustrationSize != "" && r.IllustrationSize != "large" && r.IllustrationSize != "small" {
		return errors.New("неизвестный размер иллюстраций")
	}
	if r.Mode != "auto" && r.Mode != "concept" && r.Mode != "selection" {
		return errors.New("неизвестный режим")
	}
	if len([]rune(r.Prompt)) > 2000 {
		return errors.New("запрос длиннее 2000 символов")
	}
	if r.Mode != "selection" && strings.TrimSpace(r.Prompt) == "" {
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
	if r.Mode == "auto" && len(r.AssetIDs) != 0 {
		return errors.New("в автоматическом режиме объекты определяются по запросу")
	}
	if len(r.AssetIDs) > 40 || r.Mode == "selection" && len(r.AssetIDs) == 0 {
		return errors.New("передай объекты текущего холста")
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
		if !s.has(id) || (r.Mode != "selection" && seen[id]) {
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
	if len(p.Items) < 1 || len(p.Items) > planItemLimit(r) {
		return errors.New("неверное число объектов")
	}
	found := map[string]int{}
	required := map[string]int{}
	for _, id := range r.AssetIDs {
		required[id]++
	}
	for _, i := range p.Items {
		if !s.has(i.AssetID) {
			return errors.New("модель выбрала неизвестный объект")
		}
		if r.Mode == "selection" && required[i.AssetID] == 0 {
			return errors.New("модель добавила лишний объект")
		}
		if r.Mode == "selection" && found[i.AssetID] >= required[i.AssetID] {
			return errors.New("модель повторила объект")
		}
		if i.Role != "" && i.Role != "focal" && i.Role != "support" && i.Role != "decor" {
			return errors.New("неизвестная роль объекта")
		}
		if i.Opacity != nil && (math.IsNaN(*i.Opacity) || math.IsInf(*i.Opacity, 0) || *i.Opacity < 0 || *i.Opacity > 1) {
			return errors.New("неверная прозрачность")
		}
		found[i.AssetID]++
		for _, v := range []float64{i.X, i.Y, i.Rotation} {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return errors.New("неверные координаты")
			}
		}
		if math.Abs(i.X) > 5 || math.Abs(i.Y) > 5 || math.Abs(i.Rotation) > 3600 {
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
			if found[id] != required[id] {
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
		if !strings.HasSuffix(id, "-background") && !focalAssigned {
			role = "focal"
			focalAssigned = true
		}
		if strings.HasSuffix(id, "-background") {
			role = "decor"
		}
		p.Items = append(p.Items, Item{AssetID: id, X: points[i][0], Y: points[i][1], Rotation: 0, Role: role, Depth: i})
	}

	return p
}
func canvasFor(preset, illustrationSize string) Canvas {
	c := Canvas{Width: 1000, Height: 1000, Preset: preset}
	if preset == "landscape" {
		c.Height = 633
	}
	if preset == "portrait" {
		c.Width = 750
	}
	if illustrationSize == "small" {
		c.Width = (c.Width + 1) / 2
		c.Height = (c.Height + 1) / 2
	}
	return c
}
func (s *Server) scene(p Plan, r Request) Scene {
	illustrationSize := r.IllustrationSize
	if illustrationSize == "" {
		illustrationSize = "large"
	}
	c := canvasFor(r.CanvasPreset, illustrationSize)
	backgroundPreset := r.CanvasPreset
	if backgroundPreset == "portrait" {
		backgroundPreset = "square"
	}
	palette := r.Palette
	if palette == "custom" {
		palette = "violet"
	}
	sc := Scene{Version: 2, IllustrationSize: illustrationSize, Canvas: c, Palette: r.Palette, BackgroundID: "background-" + backgroundPreset + "-" + palette, Layers: []Layer{}}
	items := append([]Item(nil), p.Items...)
	sort.SliceStable(items, func(i, j int) bool { return items[i].Depth < items[j].Depth })
	for i, item := range items {
		opacity := 1.0
		if item.Opacity != nil {
			opacity = *item.Opacity
		}
		role := item.Role
		if role == "" {
			role = "support"
		}
		sc.Layers = append(sc.Layers, Layer{ID: fmt.Sprintf("layer-%d-%d", r.Seed, i), AssetID: item.AssetID, X: math.Max(-.2, math.Min(1.2, item.X)), Y: math.Max(-.2, math.Min(1.2, item.Y)), Rotation: 0, Opacity: opacity, Visible: true, Locked: false, Role: role})
	}
	return sc
}
func (s *Server) compose(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "invalid_request", "нужен application/json")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 128<<10)
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
	if input.IllustrationSize == "" {
		input.IllustrationSize = "large"
	}
	composer := s
	if err == nil {
		composer, err = s.forRequest(input)
	}
	if err == nil {
		err = composer.validate(input)
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
	// Literal catalog-name lists can be arranged locally. Every other brief,
	// including figurative uses of catalog objects, goes straight to the planner.
	if input.Mode == "auto" {
		input = s.templateRoute(input)
		// Text-only literal lists keep the free local path; explicit selection is AI-capable.
		if input.Mode == "selection" {
			input.Planner = "template"
		}
	}
	var p Plan
	source := "fallback"
	warnings := []string{}
	if input.Planner == "template" {
		p = composer.template(input)
		warnings = append(warnings, "шаблонная раскладка, без ai")
	} else {
		if s.key == "" {
			fail(w, 503, "not_configured", "ai пока не подключен")
			return
		}
		if r.Context().Err() != nil {
			return
		}
		select {
		case s.slots <- struct{}{}:
			defer func() { <-s.slots }()
		default:
			w.Header().Set("Retry-After", "1")
			fail(w, 429, "concurrency_limit", "уже собираются две AI-композиции, попробуй чуть позже")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		ctx = context.WithValue(ctx, mainModelIPKey{}, s.clientIP(r))
		p, err = composer.plan(ctx, input)
		if err != nil {
			if r.Context().Err() != nil {
				return
			}
			var quota aiQuotaError
			if errors.As(err, &quota) {
				if quota.cause != nil {
					log.Printf("AI quota storage failed: %T", quota.cause)
					fail(w, 503, "quota_unavailable", "не удалось проверить лимит AI-генераций, попробуй позже")
				} else {
					respondQuota(w, quota)
				}
				return
			}
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				fail(w, 504, "provider_timeout", "модель не ответила вовремя, композиция сохранена")
			} else if upstream := (providerError{}); errors.As(err, &upstream) && upstream.status == 429 {
				fail(w, 429, "rate_limited", "лимит провайдера исчерпан, попробуй позже")
			} else {
				log.Printf("planner failed: %T", err)
				fail(w, 502, "provider_error", "не удалось получить корректную композицию, попробуй еще раз")
			}
			return
		}
		source = "llm"
	}
	sc, layoutWarnings := composer.refine(composer.scene(p, input))
	warnings = append(warnings, layoutWarnings...)
	respond(w, 200, map[string]any{"scene": sc, "generation": map[string]any{"mode": input.Mode, "source": source, "warnings": warnings, "concept": p.Concept, "layout": p.Layout}})
}
func (s *Server) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"status": "ok", "aiConfigured": s.key != "", "model": s.model, "guardEnabled": false})
	})
	m.HandleFunc("GET /api/v1/catalog", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, s.manifest) })
	m.HandleFunc("POST /api/v1/compositions", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Composition-Job") != "" {
			s.startJob(w, r)
		} else {
			s.compose(w, r)
		}
	})
	m.HandleFunc("GET /api/v1/compositions/{id}", s.readJob)
	m.HandleFunc("DELETE /api/v1/compositions/{id}", s.readJob)
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
		Version      int     `json:"version"`
		ObjectFactor float64 `json:"objectFactor"`
		Assets       []Asset `json:"assets"`
	}
	if err = json.Unmarshal(raw, &c); err != nil {
		log.Fatal(err)
	}
	if c.Version != 2 || c.ObjectFactor != objectFactor {
		log.Fatal("prepare both original SVG sets with scripts/prepare-assets.mjs before starting API")
	}
	if err = validateCatalog(c.Assets); err != nil {
		log.Fatal(err)
	}
	s := &Server{assets: c.Assets, manifest: raw, key: os.Getenv("OPENROUTER_API_KEY"), model: env("AI_MODEL", "openai/gpt-6-luna"), url: strings.TrimRight(env("AI_BASE_URL", "https://openrouter.ai/api/v1"), "/"), format: env("AI_RESPONSE_FORMAT", "json_schema"), client: &http.Client{Timeout: 48 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}, slots: make(chan struct{}, 2)}
	if err = s.configureQuotas(); err != nil {
		log.Fatal(err)
	}
	s.usagePath = os.Getenv("AI_USAGE_PATH")
	s.trustProxy, err = strconv.ParseBool(env("AI_TRUST_PROXY", "false"))
	if err != nil {
		log.Fatal("AI_TRUST_PROXY must be true or false")
	}
	if err = s.loadUsage(); err != nil {
		log.Fatal("could not load AI usage counters: ", err)
	}
	srv := &http.Server{Addr: env("LISTEN_ADDR", "127.0.0.1:8080"), Handler: s.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("api listening on %s; ai configured: %v", srv.Addr, s.key != "")
	log.Fatal(srv.ListenAndServe())
}
