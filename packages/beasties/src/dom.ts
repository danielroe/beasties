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

import type { ChildNode, Node, NodeWithChildren } from 'domhandler'

import { selectAll, selectOne } from 'css-select'

import { type AttributeSelector, parse as selectorParser } from 'css-what'
import render from 'dom-serializer'
import { Element, Text } from 'domhandler'
import { DomUtils, parseDocument } from 'htmlparser2'

type ParsedDocument = ReturnType<typeof parseDocument>

let classCache: null | Set<string> = null
let idCache: null | Set<string> = null

function buildCache(container: Node | HTMLDocument) {
  classCache = new Set()
  idCache = new Set()
  const queue = [container]

  while (queue.length) {
    const node = queue.shift()!

    if (node.hasAttribute?.('class')) {
      const classList = node.getAttribute('class').trim().split(' ')
      classList.forEach((cls) => {
        classCache!.add(cls)
      })
    }

    if (node.hasAttribute?.('id')) {
      const id = node.getAttribute('id').trim()
      idCache.add(id)
    }

    if ('children' in node) {
      queue.push(...node.children.filter(child => child.type === 'tag'))
    }
  }
}

/**
 * Parse HTML into a mutable, serializable DOM Document.
 * The DOM implementation is an htmlparser2 DOM enhanced with basic DOM mutation methods.
 * @param html   HTML to parse into a Document instance
 */
export function createDocument(html: string) {
  const document = parseDocument(html, { decodeEntities: false })

  extendDocument(document)

  // Extend Element.prototype with DOM manipulation methods.
  extendElement(Element.prototype)

  // Beasties container is the viewport to evaluate critical CSS
  let beastiesContainer: Node | HTMLDocument = document.querySelector('[data-beasties-container]') as Node

  if (!beastiesContainer) {
    document.documentElement?.setAttribute('data-beasties-container', '')
    beastiesContainer = document.documentElement || document
  }

  document.beastiesContainer = beastiesContainer
  buildCache(beastiesContainer)

  return document
}

/**
 * Serialize a Document to an HTML String
 */
export function serializeDocument(document: HTMLDocument) {
  return render(document, { decodeEntities: false })
}

declare module 'domhandler' {
  interface Node {
    nodeName: string
    id: string
    className: string
    insertBefore: (child: ChildNode, referenceNode: ChildNode | null) => ChildNode
    appendChild: (child: ChildNode) => ChildNode
    removeChild: (child: ChildNode) => void
    remove: () => void
    textContent: string
    setAttribute: (name: string, value: string) => void
    removeAttribute: (name: string) => void
    getAttribute: (name: string) => string
    hasAttribute: (name: string) => boolean
    getAttributeNode: (name: string) => undefined | { specified: true, value: string }
    exists: (sel: string) => boolean
    querySelector: (sel: string) => Node
    querySelectorAll: (sel: string) => Node[]
    // internal properties
    $$external?: boolean
    $$name?: string
    $$reduce?: boolean
    $$links?: ChildNode[]
  }
}

/**
 * Methods and descriptors to mix into Element.prototype
 * @private
 */
let extended = false
function extendElement(element: typeof Element.prototype) {
  if (extended) {
    return
  }
  extended = true

  Object.defineProperties(element, {
    nodeName: {
      get() {
        return this.tagName.toUpperCase()
      },
    },

    id: {
      get() {
        return this.getAttribute('id')
      },
      set(value) {
        this.setAttribute('id', value)
      },
    },

    className: {
      get() {
        return this.getAttribute('class')
      },
      set(value) {
        this.setAttribute('class', value)
      },
    },

    insertBefore: {
      value(child: ChildNode, referenceNode: ChildNode | null) {
        if (!referenceNode)
          return this.appendChild(child)
        DomUtils.prepend(referenceNode, child)
        return child
      },
    },

    appendChild: {
      value(child: ChildNode) {
        DomUtils.appendChild(this, child)
        return child
      },
    },

    removeChild: {
      value(child: ChildNode) {
        DomUtils.removeElement(child)
      },
    },

    remove: {
      value() {
        DomUtils.removeElement(this)
      },
    },

    textContent: {
      get() {
        return DomUtils.getText(this)
      },

      set(text) {
        this.children = []
        DomUtils.appendChild(this, new Text(text))
      },
    },

    setAttribute: {
      value(name: string, value: string) {
        if (this.attribs == null)
          this.attribs = {}
        if (value == null)
          value = ''
        this.attribs[name] = value
      },
    },

    removeAttribute: {
      value(name: string) {
        if (this.attribs != null) {
          delete this.attribs[name]
        }
      },
    },

    getAttribute: {
      value(name: string) {
        return this.attribs != null && this.attribs[name]
      },
    },

    hasAttribute: {
      value(name: string) {
        return this.attribs != null && this.attribs[name] != null
      },
    },

    getAttributeNode: {
      value(name: string) {
        const value = this.getAttribute(name)
        if (value != null)
          return { specified: true, value }
      },
    },

    exists: {
      value(sel: string) {
        return cachedQuerySelector(sel, this)
      },
    },

    querySelector: {
      value(sel: string) {
        return selectOne(sel, this)
      },
    },

    querySelectorAll: {
      value(sel: string) {
        return selectAll(sel, this)
      },
    },
  })
}

export interface HTMLDocument extends ParsedDocument {
  nodeType: 9
  contentType: 'text/html'
  nodeName: '#document'
  documentElement?: HTMLDocument
  head: Element
  body: Element
  createElement: (name: string) => Element
  createTextNode: (text: string) => Text
  exists: (sel: string) => boolean
  querySelector: (sel: string) => Node
  querySelectorAll: (sel: string) => Node[]
  beastiesContainer: HTMLDocument | Node
}

function extendDocument(document: ParsedDocument): asserts document is HTMLDocument {
  Object.defineProperties(document, {
    // document is just an Element in htmlparser2, giving it a nodeType of ELEMENT_NODE.
    // TODO: verify if these are needed for css-select
    nodeType: {
      get() {
        return 9
      },
    },

    contentType: {
      get() {
        return 'text/html'
      },
    },

    nodeName: {
      get() {
        return '#document'
      },
    },

    documentElement: {
      get() {
        // Find the first <html> element within the document
        return (this as NodeWithChildren).children.find(
          child => 'tagName' in child && String(child.tagName).toLowerCase() === 'html',
        )
      },
    },

    head: {
      get() {
        return this.querySelector('head')
      },
    },

    body: {
      get() {
        return this.querySelector('body')
      },
    },

    createElement: {
      value(name: string) {
        return new Element(name, {})
      },
    },

    createTextNode: {
      value(text: string) {
        // there is no dedicated createTextNode equivalent exposed in htmlparser2's DOM
        return new Text(text)
      },
    },

    exists: {
      value(sel: string) {
        return cachedQuerySelector(sel, this)
      },
    },

    querySelector: {
      value(sel: string) {
        return selectOne(sel, this)
      },
    },

    querySelectorAll: {
      value(sel: string) {
        if (sel === ':root') {
          return this
        }
        return selectAll(sel, this)
      },
    },
  })
}

// TODO: we sould probable move this case as part of the class
// so that it's disposed with it.
const selectorTokensCache = new Map<string, null | AttributeSelector[]>()

function cachedQuerySelector(sel: string, node: Node | Node[]) {
  let selectorTokens = selectorTokensCache.get(sel)
  if (selectorTokens === undefined) {
    selectorTokens = parseRelevantSelectors(sel)
    selectorTokensCache.set(sel, selectorTokens)
  }

  if (selectorTokens) {
    for (const token of selectorTokens) {
      // Check if the selector is a class selector
      if (token.name === 'class') {
        return classCache!.has(token.value)
      }
      if (token.name === 'id') {
        return idCache!.has(token.value)
      }
    }
  }

  return !!selectOne(sel, node)
}

function parseRelevantSelectors(sel: string): AttributeSelector[] | null {
  const tokens = selectorParser(sel)
  const relevantTokens: AttributeSelector[] = []

  for (let i = 0; i < tokens.length; i++) {
    const tokenGroup = tokens[i]
    if (tokenGroup?.length !== 1) {
      continue
    }

    const token = tokenGroup[0]
    if (token?.type === 'attribute' && (token.name === 'class' || token.name === 'id')) {
      relevantTokens.push(token)
    }
  }

  return relevantTokens.length > 0 ? relevantTokens : null
}
