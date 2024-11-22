/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

import type { AnyNode, ChildNode, Rule } from 'postcss'
import type Root_ from 'postcss/lib/root'
import { parse, stringify } from 'postcss'
import mediaParser, { type Child, type Root } from 'postcss-media-query-parser'

/**
 * Parse a textual CSS Stylesheet into a Stylesheet instance.
 * Stylesheet is a mutable postcss AST with format similar to CSSOM.
 * @see https://github.com/postcss/postcss/
 * @private
 */
export function parseStylesheet(stylesheet: string) {
  return parse(stylesheet)
}

/**
 * Options used by the stringify logic
 */
interface SerializeStylesheetOptions {
  /** Compress CSS output (removes comments, whitespace, etc) */
  compress?: boolean
}

/**
 * Serialize a postcss Stylesheet to a String of CSS.
 * @private
 * @param ast A Stylesheet to serialize, such as one returned from `parseStylesheet()`
 */
export function serializeStylesheet(ast: AnyNode, options: SerializeStylesheetOptions) {
  const cssParts: string[] = []

  stringify(ast, (result, node, type) => {
    if (node?.type === 'decl' && node.value.includes('</style>')) {
      return
    }

    if (!options.compress) {
      cssParts.push(result)
      return
    }

    // Simple minification logic
    if (node?.type === 'comment')
      return

    if (node?.type === 'decl') {
      const prefix = node.prop + node.raws.between

      cssParts.push(result.replace(prefix, prefix.trim()))
      return
    }

    if (type === 'start') {
      if (node?.type === 'rule' && node.selectors) {
        if (node.selectors.length === 1) {
          cssParts.push(node.selectors[0] ?? '', '{')
        }
        else {
          cssParts.push(node.selectors.join(','), '{')
        }
      }
      else {
        cssParts.push(result.trim())
      }
      return
    }

    if (type === 'end' && result === '}' && node?.raws?.semicolon) {
      const lastItemIdx = cssParts.length - 2
      if (lastItemIdx >= 0 && cssParts[lastItemIdx]) {
        cssParts[lastItemIdx] = cssParts[lastItemIdx].slice(0, -1)
      }
    }

    cssParts.push(result.trim())
  })

  return cssParts.join('')
}

type SingleIterator<T> = (item: T) => boolean | void

/**
 * Converts a walkStyleRules() iterator to mark nodes with `.$$remove=true` instead of actually removing them.
 * This means they can be removed in a second pass, allowing the first pass to be nondestructive (eg: to preserve mirrored sheets).
 * @private
 * @param predicate   Invoked on each node in the tree. Return `false` to remove that node.
 */
export function markOnly(predicate: SingleIterator<ChildNode | Root_>): (rule: Rule | ChildNode | Root_) => void {
  return (rule) => {
    const sel = 'selectors' in rule ? rule.selectors : undefined
    if (predicate(rule) === false) {
      rule.$$remove = true
    }
    if ('selectors' in rule) {
      rule.$$markedSelectors = rule.selectors
      rule.selectors = sel!
    }
    if (rule._other) {
      rule._other.$$markedSelectors = rule._other.selectors
    }
  }
}

/**
 * Apply filtered selectors to a rule from a previous markOnly run.
 * @private
 * @param rule The Rule to apply marked selectors to (if they exist).
 */
export function applyMarkedSelectors(rule: Rule) {
  if (rule.$$markedSelectors) {
    rule.selectors = rule.$$markedSelectors
  }
  if (rule._other) {
    applyMarkedSelectors(rule._other)
  }
}

/**
 * Recursively walk all rules in a stylesheet.
 * @private
 * @param node       A Stylesheet or Rule to descend into.
 * @param iterator   Invoked on each node in the tree. Return `false` to remove that node.
 */
export function walkStyleRules(node: ChildNode | Root_, iterator: SingleIterator<ChildNode | Root_ | Rule>) {
  if (!('nodes' in node)) {
    return
  }
  node.nodes = node.nodes?.filter((rule) => {
    if (hasNestedRules(rule)) {
      walkStyleRules(rule, iterator)
    }
    rule._other = undefined
    rule.filterSelectors = filterSelectors
    return iterator(rule) !== false
  })
}

/**
 * Recursively walk all rules in two identical stylesheets, filtering nodes into one or the other based on a predicate.
 * @private
 * @param node       A Stylesheet or Rule to descend into.
 * @param node2      A second tree identical to `node`
 * @param iterator   Invoked on each node in the tree. Return `false` to remove that node from the first tree, true to remove it from the second.
 */
export function walkStyleRulesWithReverseMirror(node: Rule | Root_, node2: Rule | Root_ | undefined | null, iterator: SingleIterator<ChildNode | Root_>) {
  if (!node2)
    return walkStyleRules(node, iterator);

  [node.nodes, node2.nodes] = splitFilter(
    node.nodes,
    node2.nodes,
    (rule, index, _rules, rules2) => {
      const rule2 = rules2?.[index]
      if (hasNestedRules(rule)) {
        walkStyleRulesWithReverseMirror(rule, rule2 as Rule, iterator)
      }
      rule._other = rule2 as Rule
      rule.filterSelectors = filterSelectors
      return iterator(rule) !== false
    },
  )
}

// Checks if a node has nested rules, like @media
// @keyframes are an exception since they are evaluated as a whole
function hasNestedRules(rule: ChildNode): rule is Rule {
  return (
    'nodes' in rule
    && !!rule.nodes?.length
    && (!('name' in rule) || (rule.name !== 'keyframes' && rule.name !== '-webkit-keyframes'))
    && rule.nodes.some(n => n.type === 'rule' || n.type === 'atrule')
  )
}

// Like [].filter(), but applies the opposite filtering result to a second copy of the Array without a second pass.
// This is just a quicker version of generating the compliment of the set returned from a filter operation.
type SplitIterator<T> = (item: T, index: number, a: T[], b?: T[]) => boolean
function splitFilter<T>(a: T[], b: T[], predicate: SplitIterator<T>) {
  const aOut: T[] = []
  const bOut: T[] = []
  for (let index = 0; index < a.length; index++) {
    const item = a[index]!
    if (predicate(item, index, a, b)) {
      aOut.push(item)
    }
    else {
      bOut.push(item)
    }
  }
  return [aOut, bOut] as const
}

// can be invoked on a style rule to subset its selectors (with reverse mirroring)
function filterSelectors(this: Rule, predicate: SplitIterator<string>) {
  if (this._other) {
    const [a, b] = splitFilter(
      this.selectors,
      this._other.selectors,
      predicate,
    )
    this.selectors = a
    this._other.selectors = b
  }
  else {
    this.selectors = this.selectors.filter(predicate)
  }
}

const MEDIA_TYPES = new Set(['all', 'print', 'screen', 'speech'])
const MEDIA_KEYWORDS = new Set(['and', 'not', ','])
const MEDIA_FEATURES = new Set(
  [
    'width',
    'aspect-ratio',
    'color',
    'color-index',
    'grid',
    'height',
    'monochrome',
    'orientation',
    'resolution',
    'scan',
  ].flatMap(feature => [feature, `min-${feature}`, `max-${feature}`]),
)

function validateMediaType(node: Child | Root) {
  const { type: nodeType, value: nodeValue } = node
  if (nodeType === 'media-type') {
    return MEDIA_TYPES.has(nodeValue)
  }
  else if (nodeType === 'keyword') {
    return MEDIA_KEYWORDS.has(nodeValue)
  }
  else if (nodeType === 'media-feature') {
    return MEDIA_FEATURES.has(nodeValue)
  }
}

/**
 *
 * This function performs a basic media query validation
 * to ensure the values passed as part of the 'media' config
 * is HTML safe and does not cause any injection issue
 *
 * @param query Media query to validate
 */
export function validateMediaQuery(query: string): boolean {
  // The below is needed for consumption with webpack.
  const mediaParserFn = 'default' in mediaParser ? mediaParser.default as unknown as typeof mediaParser : mediaParser
  const mediaTree = mediaParserFn(query)
  const nodeTypes = new Set(['media-type', 'keyword', 'media-feature'])

  const stack: Array<Child | Root> = [mediaTree]

  while (stack.length > 0) {
    const node = stack.pop()!

    if (nodeTypes.has(node.type) && !validateMediaType(node)) {
      return false
    }

    if (node.nodes) {
      stack.push(...node.nodes)
    }
  }

  return true
}

declare module 'postcss' {
  interface Node {
    _other?: Rule
    $$remove?: boolean
    $$markedSelectors?: string[]
    filterSelectors?: typeof filterSelectors
  }
}
