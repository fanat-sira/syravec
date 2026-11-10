package main

import (
	"strconv"
	"strings"
	"unicode"
)

// Parse a complete list, never a keyword subset of a free-form visual brief.
// Unknown or ambiguous names keep the entire original request on the LLM path.
func (s *Server) templateRoute(input Request) Request {
	input.Mode, input.AssetIDs = "concept", nil
	normalize := func(text string) string {
		text = strings.NewReplacer(",", " | ", ";", " | ", "\n", " | ", "/", " | ", "+", " | ", "&", " | ", "，", " | ").Replace(text)
		return strings.Join(strings.Fields(strings.Map(func(r rune) rune {
			if r == 'ё' {
				return 'е'
			}
			if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '|' {
				return unicode.ToLower(r)
			}
			return ' '
		}, text)), " ")
	}
	aliases := map[string]string{}
	add := func(name, id string) {
		name = normalize(name)
		if old, ok := aliases[name]; ok && old != id {
			aliases[name] = ""
		} else if !ok {
			aliases[name] = id
		}
	}
	forms := map[string]string{
		"coin":       "монета монеты монет монету монетой монетами",
		"pen":        "ручка ручки ручек ручку ручкой ручками",
		"lamp":       "лампа лампы ламп лампу лампой лампами",
		"book":       "книга книги книг книгу книгой книгами",
		"phone":      "телефон телефона телефоны телефонов телефоном телефонами",
		"wallet":     "кошелек кошелька кошельки кошельков кошельком кошельками",
		"folder":     "папка папки папок папку папкой папками",
		"headphones": "наушники наушников наушниками",
		"puzzle":     "пазл пазлы пазлов пазла пазлом пазлами",
		"flowers":    "цветы цветов цветами цветок цветка цветком",
	}
	for _, a := range s.assets {
		if a.Variant == "background" {
			continue
		}
		add(a.DisplayName, a.ID)
		for _, word := range strings.Fields(forms[strings.TrimSuffix(a.ID, "-main")]) {
			add(word, a.ID)
		}
	}
	text := normalize(input.Prompt)
	for _, prefix := range []string{"собери композицию из ", "собрать композицию из ", "собери из ", "композиция из ", "объекты "} {
		if strings.HasPrefix(text, prefix) {
			text = strings.TrimPrefix(text, prefix)
			break
		}
	}
	words := strings.Fields(text)
	lookup := func(word string) (string, bool) {
		if id, ok := aliases[word]; ok {
			return id, id != ""
		}
		// One minor typo is accepted only when every possible correction denotes
		// the same asset. Short words stay exact to avoid guessing unrelated nouns.
		if len([]rune(word)) < 5 {
			return "", false
		}
		found := ""
		for alias, id := range aliases {
			if id != "" && oneEdit(word, alias) {
				if found != "" && found != id {
					return "", false
				}
				found = id
			}
		}
		return found, found != ""
	}
	numbers := map[string]int{"один": 1, "одна": 1, "одно": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9, "десять": 10}
	count := func(word string) (int, bool) {
		if n, ok := numbers[word]; ok {
			return n, true
		}
		word = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(word, "x"), "х"), "шт")
		if word == "" {
			return 0, false
		}
		for _, r := range word {
			if r < '0' || r > '9' {
				return 0, false
			}
		}
		n, err := strconv.ParseUint(word, 10, 32)
		if err != nil || n > 40 {
			return 41, true
		}
		return int(n), true
	}
	ids := []string{}
	for i := 0; i < len(words); {
		if words[i] == "|" {
			i++
			continue
		}
		if words[i] == "и" {
			if len(ids) == 0 || i == len(words)-1 {
				return input
			}
			i++
			continue
		}
		n := 1
		if v, ok := count(words[i]); ok {
			n = v
			i++
			if i == len(words) {
				return input
			}
		}
		id, ok := lookup(words[i])
		if !ok {
			return input
		}
		i++
		if i < len(words) {
			nextIsName := false
			if i+1 < len(words) {
				_, nextIsName = lookup(words[i+1])
			}
			explicitSuffix := strings.HasPrefix(words[i], "x") || strings.HasPrefix(words[i], "х") || strings.HasSuffix(words[i], "шт")
			if v, ok := count(words[i]); ok && (!nextIsName || explicitSuffix) {
				if n != 1 {
					return input
				}
				n = v
				i++
			}
			if i < len(words) && words[i] == "шт" {
				i++
			}
		}
		for j := 0; j < n && len(ids) < 41; j++ {
			ids = append(ids, id)
		}
	}
	if len(words) > 0 && (len(ids) > 0 || strings.ContainsAny(text, "0123456789")) {
		input.Mode, input.AssetIDs = "selection", ids
	}
	return input
}

// Damerau-style adjacent transposition plus one insertion/deletion/substitution.
func oneEdit(a, b string) bool {
	x, y := []rune(a), []rune(b)
	if len(x) > len(y) {
		x, y = y, x
	}
	if len(y)-len(x) > 1 {
		return false
	}
	i := 0
	for i < len(x) && x[i] == y[i] {
		i++
	}
	if i == len(x) {
		return len(y)-len(x) <= 1
	}
	if len(x) == len(y) {
		if string(x[i+1:]) == string(y[i+1:]) {
			return true
		}
		return i+1 < len(x) && x[i] == y[i+1] && x[i+1] == y[i] && string(x[i+2:]) == string(y[i+2:])
	}
	return string(x[i:]) == string(y[i+1:])
}
