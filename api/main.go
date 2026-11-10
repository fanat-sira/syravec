package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type Asset struct {
	ID          string    `json:"id"`
	DisplayName string    `json:"displayName"`
	Variant     string    `json:"variant"`
	Tags        []string  `json:"tags"`
	ViewBox     []float64 `json:"viewBox"`
	AssetURL    string    `json:"assetUrl"`
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
}
type Scene struct {
	Version      int     `json:"version"`
	Canvas       Canvas  `json:"canvas"`
	Palette      string  `json:"palette"`
	BackgroundID string  `json:"backgroundId"`
	Layers       []Layer `json:"layers"`
}
type Request struct {
	Mode         string   `json:"mode"`
	Prompt       string   `json:"prompt"`
	AssetIDs     []string `json:"assetIds"`
	Palette      string   `json:"palette"`
	CanvasPreset string   `json:"canvasPreset"`
	Seed         int      `json:"seed"`
	Planner      string   `json:"planner"`
}
type Item struct {
	AssetID      string  `json:"assetId"`
	X            float64 `json:"preferredX"`
	Y            float64 `json:"preferredY"`
	RelativeSize float64 `json:"relativeSize"`
	Rotation     float64 `json:"rotation"`
}
type Plan struct {
	Items []Item `json:"items"`
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
	if r.Planner != "llm" && r.Planner != "template" {
		return errors.New("неизвестный способ сборки")
	}
	if len(r.AssetIDs) > 12 || r.Mode == "selection" && len(r.AssetIDs) == 0 {
		return errors.New("выбери от 1 до 12 объектов")
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
		if found[i.AssetID] {
			return errors.New("модель повторила объект")
		}
		found[i.AssetID] = true
		for _, v := range []float64{i.X, i.Y, i.RelativeSize, i.Rotation} {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return errors.New("неверные координаты")
			}
		}
		if i.X < 0 || i.X > 1 || i.Y < 0 || i.Y > 1 || i.RelativeSize <= 0 || i.RelativeSize > 3 || math.Abs(i.Rotation) > 180 {
			return errors.New("координаты вне допустимых границ")
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
	p := Plan{}
	n := len(ids)
	cols := n
	if n > 3 {
		cols = int(math.Ceil(math.Sqrt(float64(n))))
	}
	rows := int(math.Ceil(float64(n) / float64(cols)))
	for i, id := range ids {
		x, y := (float64(i%cols)+.5)/float64(cols), (float64(i/cols)+.5)/float64(rows)
		size := 1.0
		if n <= 3 {
			y = .5 + float64(i%2)*.16 - .08
			size = 1.25
			if i == 0 {
				size = 1.65
			}
		}
		p.Items = append(p.Items, Item{id, x, y, size, float64((i+r.Seed)%3-1) * 8})
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
	for i, item := range p.Items {
		var a Asset
		for _, v := range s.assets {
			if v.ID == item.AssetID {
				a = v
				break
			}
		}
		vw, vh := a.ViewBox[2], a.ViewBox[3]
		scale := item.RelativeSize
		// rotated conservative bounds; reduce an oversized proposal, then keep it inside the frame
		rad := item.Rotation * math.Pi / 180
		k := .4 * float64(min(c.Width, c.Height)) / math.Max(vw, vh)
		rw := (math.Abs(vw*math.Cos(rad)) + math.Abs(vh*math.Sin(rad))) * k
		rh := (math.Abs(vw*math.Sin(rad)) + math.Abs(vh*math.Cos(rad))) * k
		scale = math.Min(scale, math.Min(float64(c.Width)*.9/rw, float64(c.Height)*.9/rh))
		mx, my := rw*scale/2/float64(c.Width), rh*scale/2/float64(c.Height)
		x, y := math.Max(mx+.02, math.Min(1-mx-.02, item.X)), math.Max(my+.02, math.Min(1-my-.02, item.Y))
		sc.Layers = append(sc.Layers, Layer{fmt.Sprintf("layer-%d-%d", r.Seed, i), item.AssetID, x, y, scale, item.Rotation, 1, true, false})
	}
	return sc
}
func (s *Server) plan(ctx context.Context, r Request) (Plan, error) {
	catalog, _ := json.Marshal(s.assets)
	request, _ := json.Marshal(r)
	system := `You arrange existing SVG illustrations. Never output SVG or invent assets. Return JSON only: {"items":[{"assetId":"book-main","preferredX":0.5,"preferredY":0.5,"relativeSize":1.5,"rotation":0}]}. Use 2-5 items for concept mode. In selection mode include exactly the requested assetIds once each. Positions are normalized centers 0..1, size 0.5..2, clockwise rotation -25..25. Arrange an editorial composition with focal hierarchy, balanced space, mild overlap only. Honor canvas aspect ratio. Russian or English prompt. Catalog: ` + string(catalog)
	payload := map[string]any{"model": s.model, "messages": []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": string(request)}}, "max_tokens": 2200}
	if s.format == "json_schema" {
		payload["response_format"] = map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "composition", "strict": true, "schema": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"items"}, "properties": map[string]any{"items": map[string]any{"type": "array", "minItems": 1, "maxItems": 12, "items": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"assetId", "preferredX", "preferredY", "relativeSize", "rotation"}, "properties": map[string]any{"assetId": map[string]string{"type": "string"}, "preferredX": map[string]string{"type": "number"}, "preferredY": map[string]string{"type": "number"}, "relativeSize": map[string]string{"type": "number"}, "rotation": map[string]string{"type": "number"}}}}}}}}
	} else if s.format == "json_object" {
		payload["response_format"] = map[string]string{"type": "json_object"}
	}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", s.url+"/chat/completions", bytes.NewReader(b))
	if err != nil {
		return Plan{}, err
	}
	req.Header.Set("Authorization", "Bearer "+s.key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Title", "SyraVec")
	resp, err := s.client.Do(req)
	if err != nil {
		return Plan{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return Plan{}, fmt.Errorf("provider status %d", resp.StatusCode)
	}
	var data struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 256<<10)).Decode(&data); err != nil || len(data.Choices) == 0 {
		return Plan{}, errors.New("empty response")
	}
	var p Plan
	d := json.NewDecoder(strings.NewReader(data.Choices[0].Message.Content))
	d.DisallowUnknownFields()
	if err = d.Decode(&p); err != nil {
		return p, err
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return p, errors.New("extra content")
	}
	return p, s.validatePlan(p, r)
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
	respond(w, 200, map[string]any{"scene": sc, "generation": map[string]any{"mode": input.Mode, "source": source, "warnings": warnings}})
}
func (s *Server) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"status": "ok", "aiConfigured": s.key != ""})
	})
	m.HandleFunc("GET /api/v1/catalog", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, s.manifest) })
	m.HandleFunc("POST /api/v1/compositions", s.compose)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		m.ServeHTTP(w, r)
	})
}
func main() {
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
