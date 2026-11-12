// Package parsebudget applies one binding resource policy to both synchronous
// parse protocols. Grammar and node accounting belong to the maintained parser;
// this package selects its fixed limit without adding public parser options.
package parsebudget

import "mvdan.cc/sh/v3/syntax"

// MaxDepth limits the parser's node-nesting units: one for each statement,
// word part, expression, substitution or body that is open inside another while
// parsing. Flat sequences cost nothing for their length: the elements of an
// `&&`/`||` list or a pipeline, and the operands of left-associative arithmetic
// operators, are each parsed at the depth of the sequence itself, so a long
// chain costs no more than its deepest element. Their left-nested trees are
// encoded, validated, walked and printed iteratively by this binding.
//
// It is an empirical ordinary-caller bound, not a count of Go or JavaScript
// frames. Parser-created trees can reach recursive helpers while still parsing,
// so a stack-only counter would not cover the same responsibility.
const MaxDepth = 128

// NewParser preserves caller grammar options while enforcing the binding budget.
// Applying the resource option last prevents another option from disabling it;
// parser resets retain the configured limit while clearing per-input counters.
func NewParser(options ...syntax.ParserOption) *syntax.Parser {
	parser := syntax.NewParser(options...)
	syntax.ParseNestingLimit(MaxDepth)(parser)
	return parser
}
