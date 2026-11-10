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
