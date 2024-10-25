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

import { parse, stringify } from 'postcss'
import mediaParser from 'postcss-media-query-parser'

/**
 * Parse a textual CSS Stylesheet into a Stylesheet instance.
 * Stylesheet is a mutable postcss AST with format similar to CSSOM.
 * @see https://github.com/postcss/postcss/
 * @private
 * @param {string} stylesheet
 * @returns {css.Stylesheet} ast
 */
export function parseStylesheet(stylesheet) {
  return parse(stylesheet)
}

/**
 * Serialize a postcss Stylesheet to a String of CSS.
 * @private
 * @param {css.Stylesheet} ast          A Stylesheet to serialize, such as one returned from `parseStylesheet()`
 * @param {object} options              Options used by the stringify logic
 * @param {boolean} [options.compress]  Compress CSS output (removes comments, whitespace, etc)
 */
export function serializeStylesheet(ast, options) {
  let cssStr = ''

  stringify(ast, (result, node, type) => {
    if (node?.type === 'decl' && node.value.includes('</style>')) {
      return
    }

    if (!options.compress) {
      cssStr += result
      return
    }

    // Simple minification logic
    if (node?.type === 'comment')
      return

    if (node?.type === 'decl') {
      const prefix = node.prop + node.raws.between

      cssStr += result.replace(prefix, prefix.trim())
      return
    }

    if (type === 'start') {
      if (node.type === 'rule' && node.selectors) {
        cssStr += `${node.selectors.join(',')}{`
      }
      else {
        cssStr += result.replace(/\s\{$/, '{')
      }
      return
    }

    if (type === 'end' && result === '}' && node?.raws?.semicolon) {
      cssStr = cssStr.slice(0, -1)
    }

    cssStr += result.trim()
  })

  return cssStr
}

/**
 * Converts a walkStyleRules() iterator to mark nodes with `.$$remove=true` instead of actually removing them.
 * This means they can be removed in a second pass, allowing the first pass to be nondestructive (eg: to preserve mirrored sheets).
 * @private
 * @param {Function} iterator   Invoked on each node in the tree. Return `false` to remove that node.
 * @returns {(rule) => void} nonDestructiveIterator
 */
export function markOnly(predicate) {
  return (rule) => {
    const sel = rule.selectors
    if (predicate(rule) === false) {
      rule.$$remove = true
    }
    rule.$$markedSelectors = rule.selectors
    if (rule._other) {
      rule._other.$$markedSelectors = rule._other.selectors
    }
    rule.selectors = sel
  }
}

/**
 * Apply filtered selectors to a rule from a previous markOnly run.
 * @private
 * @param {css.Rule} rule The Rule to apply marked selectors to (if they exist).
 */
export function applyMarkedSelectors(rule) {
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
 * @param {css.Rule} node       A Stylesheet or Rule to descend into.
 * @param {Function} iterator   Invoked on each node in the tree. Return `false` to remove that node.
 */
export function walkStyleRules(node, iterator) {
  node.nodes = node.nodes.filter((rule) => {
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
 * @param {css.Rule} node       A Stylesheet or Rule to descend into.
 * @param {css.Rule} node2      A second tree identical to `node`
 * @param {Function} iterator   Invoked on each node in the tree. Return `false` to remove that node from the first tree, true to remove it from the second.
 */
export function walkStyleRulesWithReverseMirror(node, node2, iterator) {
  if (node2 === null)
    return walkStyleRules(node, iterator);

  [node.nodes, node2.nodes] = splitFilter(
    node.nodes,
    node2.nodes,
    (rule, index, rules, rules2) => {
      const rule2 = rules2[index]
      if (hasNestedRules(rule)) {
        walkStyleRulesWithReverseMirror(rule, rule2, iterator)
      }
      rule._other = rule2
      rule.filterSelectors = filterSelectors
      return iterator(rule) !== false
    },
  )
}

// Checks if a node has nested rules, like @media
// @keyframes are an exception since they are evaluated as a whole
function hasNestedRules(rule) {
  return (
    rule.nodes?.length
    && rule.name !== 'keyframes'
    && rule.name !== '-webkit-keyframes'
    && rule.nodes.some(n => n.type === 'rule' || n.type === 'atrule')
  )
}

// Like [].filter(), but applies the opposite filtering result to a second copy of the Array without a second pass.
// This is just a quicker version of generating the compliment of the set returned from a filter operation.
function splitFilter(a, b, predicate) {
  const aOut = []
  const bOut = []
  for (let index = 0; index < a.length; index++) {
    if (predicate(a[index], index, a, b)) {
      aOut.push(a[index])
    }
    else {
      bOut.push(a[index])
    }
  }
  return [aOut, bOut]
}

// can be invoked on a style rule to subset its selectors (with reverse mirroring)
function filterSelectors(predicate) {
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

function validateMediaType(node) {
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
 * @param {string} Media query to validate
 * @returns {boolean}
 *
 * This function performs a basic media query validation
 * to ensure the values passed as part of the 'media' config
 * is HTML safe and does not cause any injection issue
 */
export function validateMediaQuery(query) {
  // The below is needed for consumption with webpack.
  const mediaParserFn = 'default' in mediaParser ? mediaParser.default : mediaParser
  const mediaTree = mediaParserFn(query)
  const nodeTypes = new Set(['media-type', 'keyword', 'media-feature'])

  const stack = [mediaTree]

  while (stack.length > 0) {
    const node = stack.pop()

    if (nodeTypes.has(node.type) && !validateMediaType(node)) {
      return false
    }

    if (node.nodes) {
      stack.push(...node.nodes)
    }
  }

  return true
}
