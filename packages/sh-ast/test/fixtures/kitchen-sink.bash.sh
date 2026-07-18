#!/bin/bash
# A leading comment, for Comment coverage.
echo "hello $USER, you are ${USER:-nobody}" 'and single quoted'
echo "${USER:1:2}" "${USER/foo/bar}"

x=1
y=$((x + 2))
z=$(( (1 + 2) * 3 ))
((x++))

if [ -n "$x" ]; then
  echo yes
elif [ -z "$x" ]; then
  echo no
else
  echo maybe
fi

while read -r line; do
  echo "$line"
done < "$0"

for i in 1 2 3; do
  echo "$i"
done

for ((i = 0; i < 3; i++)); do
  echo "$i"
done

greet() {
  echo "in function"
}
greet

(echo in a subshell)

echo one && echo two || echo three

case "$x" in
  a | b) echo ab ;;
  *) echo default ;;
esac

declare -i n=5
arr=(one two three)
echo "${arr[1]}"
declare -A assoc=([key]=value)

time echo timed

coproc worker { echo coproc body; }

let "z2 = 1 + 2"

echo ?(b)*(c)+(d)@(e)!(f)

greet >(cat)
greet < <(echo procsub)

[[ -n "$x" && -z "$y" ]]
[[ (-n "$x") ]]

echo "$(echo command substitution)"

cat <<'HEREDOC'
heredoc body
HEREDOC

echo piped | wc -l

! false

sleep 0 &
