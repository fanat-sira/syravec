package main

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
)

func TestLiteralCatalogNamesUseServerWithoutModels(t *testing.T) {
	s := modelFixture()
	s.assets[1].DisplayName = "Лампа"
	calls := 0
	s.client.Transport = requestTransport(func(r *http.Request) (*http.Response, error) { calls++; return successfulPlan(s, r), nil })
	for _, prompt := range []string{"Книга, Лампа", "книга; лампа", "Книга\nЛампа"} {
		response := compositionCall(s, prompt)
		var result struct {
			Scene      Scene `json:"scene"`
			Generation struct {
				Source string `json:"source"`
				Mode   string `json:"mode"`
			} `json:"generation"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if response.Code != 200 || calls != 0 || len(s.calls) != 0 || result.Generation.Source != "fallback" || result.Generation.Mode != "selection" {
			t.Fatalf("local route failed: %d %s", response.Code, response.Body.String())
		}
		found := map[string]int{}
		for _, l := range result.Scene.Layers {
			found[l.AssetID]++
		}
		if !reflect.DeepEqual(found, map[string]int{"book-main": 1, "lamp-main": 1}) {
			t.Fatalf("wrong selection: %v", found)
		}
	}
}
func TestAutoValidationAndFreeTextRouting(t *testing.T) {
	s := fixture()
	input := req()
	input.Mode = "auto"
	input.AssetIDs = nil
	input.Prompt = "Книга"
	if err := s.validate(input); err != nil {
		t.Fatal(err)
	}
	resolved := s.templateRoute(input)
	if resolved.Mode != "selection" || len(resolved.AssetIDs) != 1 {
		t.Fatalf("%+v", resolved)
	}
	for _, prompt := range []string{"циферблат это монета а стрелки это ручки", "неизвестный объект", "книга и знания"} {
		input.Prompt = prompt
		resolved = s.templateRoute(input)
		if resolved.Mode != "concept" || resolved.Prompt != prompt || len(resolved.AssetIDs) != 0 {
			t.Fatalf("free brief must stay intact: %+v", resolved)
		}
	}
	input.Prompt = ""
	if s.validate(input) == nil {
		t.Fatal("empty auto prompt allowed")
	}
	input.Prompt = "идея"
	input.AssetIDs = []string{s.assets[0].ID}
	if s.validate(input) == nil {
		t.Fatal("manual IDs override automatic routing")
	}
}

func TestNormalizedListsPreserveEveryOccurrence(t *testing.T) {
	s := realCatalog(t)
	for _, tc := range []struct {
		prompt string
		want   map[string]int
	}{
		{"монета, монета, ручка, монета, монета, монета, лампа, монета, монета, монета", map[string]int{"coin-main": 8, "pen-main": 1, "lamp-main": 1}},
		{"  МОНЕТА,\u00a0монета, «РУЧКА»; лампа. ", map[string]int{"coin-main": 2, "pen-main": 1, "lamp-main": 1}},
		{"2 монеты, 3 ручки и одна лампа", map[string]int{"coin-main": 2, "pen-main": 3, "lamp-main": 1}},
		{"монета x3; ручка 2шт; лампа", map[string]int{"coin-main": 3, "pen-main": 2, "lamp-main": 1}},
		{"собери композицию из монет, ручки и лампы", map[string]int{"coin-main": 1, "pen-main": 1, "lamp-main": 1}},
		{"кошелёк / наушники + пазл", map[string]int{"wallet-main": 1, "headphones-main": 1, "puzzle-main": 1}},
		{"монтеа, лампа", map[string]int{"coin-main": 1, "lamp-main": 1}},
	} {
		t.Run(tc.prompt, func(t *testing.T) {
			r := req()
			r.Mode = "auto"
			r.AssetIDs = nil
			r.Prompt = tc.prompt
			resolved := s.templateRoute(r)
			got := map[string]int{}
			for _, id := range resolved.AssetIDs {
				got[id]++
			}
			if resolved.Mode != "selection" || !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("route=%s counts=%v", resolved.Mode, got)
			}
			data, _ := json.Marshal(r)
			w := call(s, string(data))
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			var response struct {
				Scene Scene `json:"scene"`
			}
			_ = json.Unmarshal(w.Body.Bytes(), &response)
			got = map[string]int{}
			for _, l := range response.Scene.Layers {
				got[l.AssetID]++
				if l.Rotation != 0 {
					t.Fatal("automatic rotation")
				}
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatal("lost occurrences", got)
			}
		})
	}
}
func TestListRoutingDoesNotDiscardUnknownWordsOrExceedLimit(t *testing.T) {
	s := realCatalog(t)
	for _, text := range []string{"книга и знания", "монета как солнце", "свет лампы освещает монеты", "монета, дракон, лампа", "лампа без монеты", "и монета", "монета и"} {
		r := Request{Mode: "auto", Prompt: text}
		out := s.templateRoute(r)
		if out.Mode != "concept" || len(out.AssetIDs) != 0 || out.Prompt != text {
			t.Fatal("brief was partially consumed", text, out)
		}
	}
	for _, text := range []string{"41 монета", "999999999999999999 монет", "0 монет"} {
		r := req()
		r.Mode = "auto"
		r.AssetIDs = nil
		r.Prompt = text
		data, _ := json.Marshal(r)
		w := call(s, string(data))
		if w.Code != 400 {
			t.Fatal("invalid list reached planner", text, w.Code, w.Body.String())
		}
	}
}

func TestUnrecognizedAutoBriefDoesNotBecomeKeywordTemplate(t *testing.T) {
	s := realCatalog(t)
	r := req()
	r.Mode = "auto"
	r.AssetIDs = nil
	r.Prompt = "монета как солнце"
	r.Planner = "template"
	data, _ := json.Marshal(r)
	w := call(s, string(data))
	if w.Code != 503 {
		t.Fatalf("unknown brief silently used a template: %d %s", w.Code, w.Body.String())
	}
}
