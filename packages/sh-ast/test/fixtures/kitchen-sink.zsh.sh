#!/bin/zsh
# zsh-only fixture: FlagsArithm (subscript flags), unreachable in bash/mksh.
# @see mvdan.cc/sh/v3/syntax filetests_test.go, `${signals[(i)QUIT]}`.
echo "${signals[(i)QUIT]}"
