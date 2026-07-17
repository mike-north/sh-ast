#!/usr/bin/env bats
# bats-only fixture: TestDecl (`@test` declarations), unreachable outside bats.
@test "addition works" {
  result="$((2 + 2))"
  [ "$result" -eq 4 ]
}
