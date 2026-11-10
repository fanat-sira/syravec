package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func routingAnswers(s *Server, scenario string, selected []int) map[string]any {
	var body struct {
		Answers map[string]any `json:"answers"`
	}
	_ = json.Unmarshal([]byte(guardAnswers(.99, .01)), &body)
	if !s.guardEnabled {
		body.Answers = map[string]any{}
	}
	body.Answers["scenario"] = map[string]any{"type": "choice", "choice": scenario, "probabilities": map[string]float64{"concept": .01, "selection": .99}}
	if scenario == "concept" {
		body.Answers["scenario"] = map[string]any{"type": "choice", "choice": scenario, "probabilities": map[string]float64{"concept": .99, "selection": .01}}
	}
	body.Answers["catalog_coverage"] = map[string]any{"type": "noul", "noul": .99}
	for i := range s.assets {
		value := .01
		for _, chosen := range selected {
			if i == chosen {
				value = .99
			}
		}
		body.Answers[fmt.Sprintf("asset_%d", i)] = map[string]any{"type": "noul", "noul": value}
	}
	return body.Answers
}
func TestAutoRoutingOneClassifierThenExactPlanner(t *testing.T) {
	// Mock scores test our routing contract, not model semantic accuracy.
	for _, mode := range []string{"concept", "selection"} {
		t.Run(mode, func(t *testing.T) {
			s := guardedFixture()
			calls := []string{}
			s.client = &http.Client{Transport: guardTransport(func(r *http.Request) (*http.Response, error) {
				calls = append(calls, r.URL.Host)
				if r.URL.Host == "guard.test" {
					var payload struct {
						State     map[string]json.RawMessage  `json:"state"`
						Questions map[string]decisionQuestion `json:"questions"`
					}
					_ = json.NewDecoder(r.Body).Decode(&payload)
					if len(payload.Questions) != len(s.assets)+4 || payload.Questions["scenario"].Type != "choice" || len(payload.State["catalog"]) == 0 {
						t.Fatal("missing routing context")
					}
					data, _ := json.Marshal(map[string]any{"answers": routingAnswers(s, mode, []int{0, 1})})
					return guardResponse(r, 200, string(data)), nil
				}
				var payload struct {
					Messages []struct {
						Content string `json:"content"`
					} `json:"messages"`
				}
				_ = json.NewDecoder(r.Body).Decode(&payload)
				all := ""
				for _, m := range payload.Messages {
					all += m.Content
				}
				if !strings.Contains(all, `"mode":"`+mode+`"`) {
					t.Fatalf("unresolved planner input: %s", all)
				}
				input := req()
				input.Mode = mode
				input.AssetIDs = []string{s.assets[0].ID, s.assets[1].ID}
				content, _ := json.Marshal(s.template(input))
				body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": string(content)}}}})
				return guardResponse(r, 200, string(body)), nil
			})}
			input := req()
			input.Mode = "auto"
			input.AssetIDs = nil
			input.Planner = "llm"
			input.Prompt = "свободный запрос"
			raw, _ := json.Marshal(input)
			response := call(s, string(raw))
			if response.Code != 200 || len(calls) != 2 || calls[0] != "guard.test" {
				t.Fatalf("%d %s calls=%v", response.Code, response.Body.String(), calls)
			}
			if mode == "selection" {
				var result struct {
					Scene Scene `json:"scene"`
				}
				_ = json.Unmarshal(response.Body.Bytes(), &result)
				if len(result.Scene.Layers) != 2 {
					t.Fatal("selection lost or gained objects")
				}
			}
		})
	}
}
func TestAutoRoutingAmbiguityAndMalformedFailClosed(t *testing.T) {
	cases := []struct {
		name   string
		modify func(map[string]any)
	}{
		{"unknown component", func(a map[string]any) { a["catalog_coverage"] = map[string]any{"type": "noul", "noul": .1} }},
		{"ambiguous object", func(a map[string]any) { a["asset_0"] = map[string]any{"type": "noul", "noul": .5} }},
		{"missing object", func(a map[string]any) { delete(a, "asset_0") }},
		{"invalid probability", func(a map[string]any) { a["asset_0"] = map[string]any{"type": "noul", "noul": 2} }},
		{"unknown scenario", func(a map[string]any) { a["scenario"] = map[string]any{"type": "choice", "choice": "other"} }},
		{"refusal", func(a map[string]any) { a["scenario"] = map[string]any{"type": "refusal"} }},
		{"off task", func(a map[string]any) { a["off_task_instructions"] = map[string]any{"type": "noul", "noul": .99} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := guardedFixture()
			answers := routingAnswers(s, "selection", []int{0})
			tc.modify(answers)
			data, _ := json.Marshal(map[string]any{"answers": answers})
			s.client = &http.Client{Transport: guardTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host != "guard.test" {
					t.Fatal("generator must not run")
				}
				return guardResponse(r, 200, string(data)), nil
			})}
			_, decision, err := s.routePrompt(context.Background(), Request{Mode: "auto", Prompt: "запрос"})
			if err == nil && decision == guardAllow {
				t.Fatal("unsafe route allowed")
			}
		})
	}
}
func TestAutoValidationAndFreeTemplate(t *testing.T) {
	s := fixture()
	input := req()
	input.Mode = "auto"
	input.AssetIDs = nil
	input.Prompt = s.assets[0].DisplayName
	if err := s.validate(input); err != nil {
		t.Fatal(err)
	}
	resolved := s.templateRoute(input)
	if resolved.Mode != "selection" || len(resolved.AssetIDs) != 1 {
		t.Fatalf("%+v", resolved)
	}
	input.Prompt = ""
	if s.validate(input) == nil {
		t.Fatal("empty auto prompt allowed")
	}
	input.Prompt = "идея"
	input.AssetIDs = []string{s.assets[0].ID}
	if s.validate(input) == nil {
		t.Fatal("manual IDs override auto routing")
	}
	s = guardedFixture()
	s.guardEnabled = false
	answers := routingAnswers(s, "concept", nil)
	data, _ := json.Marshal(map[string]any{"answers": answers})
	s.client = &http.Client{Transport: guardTransport(func(r *http.Request) (*http.Response, error) { return guardResponse(r, 200, string(data)), nil })}
	input = req()
	input.Prompt = "идея иллюстрации"
	input.Mode = "auto"
	input.AssetIDs = nil
	resolved, decision, err := s.routePrompt(context.Background(), input)
	if err != nil || decision != guardAllow || resolved.Mode != "concept" {
		t.Fatalf("%+v %s %v", resolved, decision, err)
	}
}
