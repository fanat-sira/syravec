package main

import "strings"

// Only exact catalog-name lists use the local layout. All other text, including
// metaphors and unknown names, remains a concept for the main model to interpret.
func (s *Server) templateRoute(input Request) Request {
	input.Mode = "concept"
	normalize := func(s string) string { return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(s)), "ё", "е") }
	text := normalize(input.Prompt)
	parts := strings.FieldsFunc(text, func(r rune) bool { return r == ',' || r == ';' || r == '\n' })
	ids := []string{}
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
		ids = append(ids, found)
	}
	if len(ids) > 0 && len(ids) <= 40 {
		input.Mode = "selection"
		input.AssetIDs = ids
	}
	return input
}
