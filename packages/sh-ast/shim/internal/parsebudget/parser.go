// Package parsebudget applies one binding resource policy to both synchronous
// parse protocols. Grammar and node accounting belong to the maintained parser;
// this package selects its fixed limit without adding public parser options.
package parsebudget

import "mvdan.cc/sh/v3/syntax"

// MaxDepth limits upstream node-nesting work, including iteratively constructed
// operator trees. It is an empirical ordinary-caller bound, not a count of Go or
// JavaScript frames. Parser-created trees can reach recursive helpers while still
// parsing, so a stack-only counter would not cover the same responsibility.
const MaxDepth = 128

// NewParser preserves caller grammar options while enforcing the binding budget.
// Applying the resource option last prevents another option from disabling it;
// parser resets retain the configured limit while clearing per-input counters.
func NewParser(options ...syntax.ParserOption) *syntax.Parser {
	parser := syntax.NewParser(options...)
	syntax.ParseNestingLimit(MaxDepth)(parser)
	return parser
}
