/**
 * Parsing of in-CSS comment directives (`/* beasties:include start *\/` and friends).
 *
 * Shared by the runtime path (`index.ts`) and the build-time compiler
 * (`compiler.ts`) so both accept the same spellings and produce the same
 * diagnostics.
 */

type DirectiveCommand
  = | 'include'
    | 'exclude'
    | 'include start'
    | 'include end'
    | 'exclude start'
    | 'exclude end'

const DIRECTIVE_RE = /^(beasties|critters):(.*)$/
/**
 * A comment which looks like a directive but uses an unknown namespace, e.g.
 * `/* critter:include *\/`. Deliberately narrow: a single bare word followed by
 * `include`/`exclude` and an optional `start`/`end`, and nothing else, so that
 * license banners, sourcemap comments and ordinary prose never match.
 */
const DIRECTIVE_LOOKALIKE_RE = /^([\w-]+):(include|exclude)(?: (start|end))?$/

const COMMANDS = new Set<string>(['include', 'exclude', 'include start', 'include end', 'exclude start', 'exclude end'])

const SUPPORTED_DIRECTIVES = [...COMMANDS].map(command => `beasties:${command}`).join(', ')

export interface DirectiveResult {
  command?: DirectiveCommand
  /** Set when a `critters:` prefixed directive was used */
  deprecated?: boolean
  /** Set when the comment looked like a directive but could not be understood */
  warning?: string
}

/**
 * Interpret a CSS comment's text as a beasties directive.
 *
 * `text` is the comment body with the delimiters removed and whitespace
 * trimmed, i.e. postcss' `Comment#text`. Comments beginning with `!` (legal
 * comments preserved by minifiers) are not treated as directives.
 */
export function parseDirective(text: string): DirectiveResult {
  const match = text.match(DIRECTIVE_RE)
  if (match) {
    const command = match[2]!.trim()
    if (COMMANDS.has(command)) {
      return { command: command as DirectiveCommand, deprecated: match[1] === 'critters' }
    }
    return { warning: `Unknown comment directive "${text}". Supported directives are: ${SUPPORTED_DIRECTIVES}.` }
  }

  const lookalike = text.match(DIRECTIVE_LOOKALIKE_RE)
  if (lookalike) {
    const command = lookalike[3] ? `${lookalike[2]} ${lookalike[3]}` : lookalike[2]
    return { warning: `Ignoring unrecognised comment directive "${text}". Did you mean "beasties:${command}"?` }
  }

  return {}
}

export const CRITTERS_DEPRECATION_WARNING: string = 'Found deprecated "critters:" comment directives. Use the "beasties:" prefix instead, for example "/* beasties:include start */".'
