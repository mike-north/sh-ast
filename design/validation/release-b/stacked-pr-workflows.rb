# Verifies the candidate workflow event contract for main and stacked PR bases.
# This bounded configuration check does not replace observing actual GitHub runs.
require 'yaml'

# The fixtures are repository requirements, independent of the current filters.
required_bases = ['main', 'codex/faithful-syntax-release-plan']
workflow_names = ['ci', 'wasm-reproducibility', 'gen-visitor-keys', 'codex-review-gate']
failures = []
workflow_names.each do |name|
  config = YAML.load_file(".github/workflows/#{name}.yml")
  # Ruby's YAML 1.1 parser treats the unquoted GitHub event key as boolean true.
  events = config.fetch('on', config[true])
  # Metadata-only review checks use the trusted base event to write a PR-head
  # check without checking out PR code; build validators keep pull_request.
  event = name == 'codex-review-gate' ? 'pull_request_target' : 'pull_request'
  unless events.key?(event)
    failures << "#{name}: #{event} event is missing"
    next
  end
  filters = events[event] || {}
  required_bases.each do |base|
    included = !filters.key?('branches') || filters['branches'].any? { |pattern| File.fnmatch(pattern, base) }
    excluded = (filters['branches-ignore'] || []).any? { |pattern| File.fnmatch(pattern, base) }
    failures << "#{name}: PR base #{base} is excluded" unless included && !excluded
  end
end

# Stacked validation must not broaden the independently authorized release trigger.
release = YAML.load_file('.github/workflows/release.yml')
release_events = release.fetch('on', release[true])
failures << 'release workflow must remain push-to-main only' unless release_events.keys == ['push'] && release_events['push']['branches'] == ['main']
abort failures.join("\n") unless failures.empty?
puts 'Main and stacked PR validation events pass; release trigger remains main-only.'
