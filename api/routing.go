package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

type routeAnswer struct {
	Type          string             `json:"type"`
	Noul          *float64           `json:"noul"`
	Choice        string             `json:"choice"`
	Probabilities map[string]float64 `json:"probabilities"`
}

func probability(p *float64) bool {
	return p != nil && !math.IsNaN(*p) && !math.IsInf(*p, 0) && *p >= 0 && *p <= 1
}

// Routing and optional intent validation share one classifier call. Only catalog
// IDs accepted here can reach the planner; the planner still validates its scene.
func (s *Server) routePrompt(ctx context.Context, input Request) (Request, guardDecision, error) {
	data, err := s.requestDecisions(ctx, input, true)
	if err != nil {
		return input, "", err
	}
	var result struct {
		Answers map[string]routeAnswer `json:"answers"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return input, "", err
	}
	expected := len(s.assets) + 2
	if s.guardEnabled {
		expected += 2
	}
	if len(result.Answers) != expected {
		return input, "", errors.New("incomplete routing answers")
	}
	for _, answer := range result.Answers {
		if answer.Type == "refusal" {
			return input, guardUncertain, nil
		}
	}
	if s.guardEnabled {
		subset := map[string]routeAnswer{}
		for _, name := range []string{"visual_intent", "off_task_instructions"} {
			subset[name] = result.Answers[name]
		}
		raw, _ := json.Marshal(map[string]any{"answers": subset})
		decision, err := parseGuard(raw)
		if err != nil || decision != guardAllow {
			return input, decision, err
		}
	}
	scenario := result.Answers["scenario"]
	if scenario.Type != "choice" || scenario.Choice != "concept" && scenario.Choice != "selection" || len(scenario.Probabilities) != 2 {
		return input, "", errors.New("invalid routing scenario")
	}
	sum := 0.0
	for _, name := range []string{"concept", "selection"} {
		value, ok := scenario.Probabilities[name]
		if !ok || !probability(&value) {
			return input, "", errors.New("invalid scenario probability")
		}
		sum += value
	}
	if math.Abs(sum-1) > .01 {
		return input, "", errors.New("invalid scenario distribution")
	}
	if scenario.Probabilities[scenario.Choice] < .8 {
		return input, guardUncertain, nil
	}
	coverage := result.Answers["catalog_coverage"]
	if coverage.Type != "noul" || !probability(coverage.Noul) {
		return input, "", errors.New("invalid catalog coverage")
	}
	ids := []string{}
	for i, asset := range s.assets {
		answer, ok := result.Answers[fmt.Sprintf("asset_%d", i)]
		if !ok || answer.Type != "noul" || !probability(answer.Noul) {
			return input, "", errors.New("invalid asset decision")
		}
		if scenario.Choice == "selection" {
			if *answer.Noul > .2 && *answer.Noul < .8 {
				return input, guardUncertain, nil
			}
			if *answer.Noul >= .8 {
				ids = append(ids, asset.ID)
			}
		}
	}
	if scenario.Choice == "selection" && (*coverage.Noul < .8 || len(ids) == 0 || len(ids) > 12) {
		return input, guardUncertain, nil
	}
	input.Mode = scenario.Choice
	input.AssetIDs = ids
	if err := s.validate(input); err != nil {
		return input, "", err
	}
	return input, guardAllow, nil
}

// Only exact catalog-name lists use the local layout. All other text, including
// metaphors and unknown names, remains a concept for the main model to interpret.
func (s *Server) templateRoute(input Request) Request {
	input.Mode = "concept"
	normalize := func(s string) string { return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(s)), "ё", "е") }
	text := normalize(input.Prompt)
	parts := strings.FieldsFunc(text, func(r rune) bool { return r == ',' || r == ';' || r == '\n' })
	ids := []string{}
	seen := map[string]bool{}
	for _, part := range parts {
		found := ""
		for _, asset := range s.assets {
			if asset.Variant != "background" && normalize(asset.DisplayName) == normalize(part) {
				found = asset.ID
				break
			}
		}
		if found == "" {
			return input
		}
		if !seen[found] {
			ids = append(ids, found)
			seen[found] = true
		}
	}
	if len(ids) > 0 && len(ids) <= 12 {
		input.Mode = "selection"
		input.AssetIDs = ids
	}
	return input
}
