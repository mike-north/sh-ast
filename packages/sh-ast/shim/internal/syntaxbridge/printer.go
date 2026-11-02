package syntaxbridge

import (
	"bytes"
	"fmt"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// printNode reconstructs the supplied current tree and collects upstream output.
// It never reparses source text. A fresh printer owns each call's formatting
// state; arbitrary io.Writer lifecycles, writer failures and partial-output
// recovery are outside this collected-output operation.
func printNode(payload, options string) map[string]any {
	opts, err := printerOptions(options)
	if err != nil {
		return errorResponse("InputError", err.Error())
	}
	node, err := syntaxwire.DecodeNode([]byte(payload))
	if err != nil {
		return errorResponse("InputError", err.Error())
	}
	return collectPrintedNode(node, opts)
}

// collectPrintedNode keeps an ordinary upstream Print error distinct from a
// panic raised by that operation. Complete but partial/typed-nil syntax values
// can panic upstream; they must not masquerade as unsupported-root errors or
// poison the shared runtime. Panics outside this narrow call remain internal
// bridge failures handled by Process.
func collectPrintedNode(node syntax.Node, options []syntax.PrinterOption) (result map[string]any) {
	// Construction is outside panic adaptation: only the Print operation owns
	// the public PrintPanicError contract.
	printer := syntax.NewPrinter(options...)
	defer func() {
		if failure := recover(); failure != nil {
			result = errorResponse("PrintPanicError", fmt.Sprint(failure))
		}
	}()
	var output bytes.Buffer
	if err := printer.Print(&output, node); err != nil {
		return errorResponse("PrintError", err.Error())
	}
	return map[string]any{"Output": syntaxwire.String(output.String())}
}

// printerOptions passes the pinned option domains without inventing a numeric
// indentation cap. Indent is Go uint64, including values which upstream later
// rejects or which request expensive output. The seven flags set independent
// printer properties; Minify+SingleLine incompatibility remains upstream Print's
// own error, checked before root dispatch. No reusable option functions escape.
func printerOptions(text string) ([]syntax.PrinterOption, error) {
	obj, err := object(text)
	if err != nil {
		return nil, err
	}
	// Fixed application order makes the wire's object property order irrelevant.
	// These setters are independent in the pinned upstream version.
	flags := []struct {
		name       string
		makeOption func(bool) syntax.PrinterOption
	}{
		{"BinaryNextLine", syntax.BinaryNextLine},
		{"SwitchCaseIndent", syntax.SwitchCaseIndent},
		{"SpaceRedirects", syntax.SpaceRedirects},
		{"KeepPadding", syntax.KeepPadding},
		{"Minify", syntax.Minify},
		{"SingleLine", syntax.SingleLine},
		{"FunctionNextLine", syntax.FunctionNextLine},
	}
	for name := range obj {
		known := name == "Indent"
		for _, flag := range flags {
			known = known || name == flag.name
		}
		if !known {
			return nil, fmt.Errorf("unknown printer option %q", name)
		}
	}
	opts := make([]syntax.PrinterOption, 0, 8)
	if value, present := obj["Indent"]; present {
		spaces, err := unsignedInput(value)
		if err != nil {
			return nil, fmt.Errorf("Indent: %w", err)
		}
		opts = append(opts, syntax.Indent(spaces))
	}
	for _, flag := range flags {
		if value, present := obj[flag.name]; present {
			enabled, ok := value.(bool)
			if !ok {
				return nil, fmt.Errorf("%s must be boolean", flag.name)
			}
			opts = append(opts, flag.makeOption(enabled))
		}
	}
	return opts, nil
}
