// Purpose: create a completely comment-annotated version of this file for personal understanding

// hyperapp.h creates a virtual DOM node. 'name' can either be a primitive like 'div', or a
// custom component (which is a function), e.g. 'myComponent'
// attributes are HTML attributes like 'style', 'onclick'
export function h(name, attributes) {
  var rest = []
  var children = []
  var length = arguments.length
  
  // any additional arguments (in addition to name and attributes) are pushed to the 'rest' array
  while (length-- > 2) rest.push(arguments[length])
  
  // the 'rest' array elements are pushed to the 'children' array unless they are undefined, null, or a boolean
  // if some of the elements are arrays, they are flattened
  // so var rest = [el, el, [el, el], null] becomes var children = [el, el, el, el]
  while (rest.length) {
    var node = rest.pop()
    if (node && node.pop) {
      for (length = node.length; length--; ) {
        rest.push(node[length])
      }
    } else if (node != null && node !== true && node !== false) {
      children.push(node)
    }
  }
  
  // if 'name' is a function, that means it's a custom component (which is a pure function).
  // return the result of calling that function.
  // if 'name' is a primitive like 'div', 'h1', return a virtual DOM node (plain JS object) with
  // nodeName, attributes, children and key
  // any custom components (functions) will eventually return "primitive" virtual DOM nodes
  return typeof name === "function"
    ? name(attributes || {}, children)
    : {
        nodeName: name, // String eg. 'div'
        attributes: attributes || {}, // Object with keys eg. 'style'
        children: children, // Array of child elements 
        key: attributes && attributes.key // key is used to identify an existing element to prevent re-renders, more on this later
      }
}

// hyperapp.app bolts the virtual DOM tree into a real DOM element so the app actually gets rendered.
// state: Object that describes the application state (key-value pairs like counterValue: 666 for some counter widget)
// actions: Object of functions that take state as an input and return a new modified state
// view: The virtual DOM tree of the application, created with hyperapp.h,
// container: the container element to bolt the virtual DOM into
export function app(state, actions, view, container) {
  var map = [].map // simply a reference to Array.prototype.map
  var rootElement = (container && container.children[0]) || null // first child of the container element or null
  var oldNode = rootElement && recycleElement(rootElement) // if rootElement exists, call recycleElement on it
  var lifecycle = [] // an array of lifecycle methods
  var skipRender // boolean used to decide if a re-render should happen or not. default false
  var isRecycling = true
  var globalState = clone(state) // 
  var wiredActions = wireStateToActions([], globalState, clone(actions))

  scheduleRender()

  return wiredActions
  
  // Convert a real DOM element into a Virtual DOM element recursively
  function recycleElement(element) {
    return {
      nodeName: element.nodeName.toLowerCase(),
      attributes: {},
      children: map.call(element.childNodes, function(element) {
        return element.nodeType === 3 // Node.TEXT_NODE
          ? element.nodeValue
          : recycleElement(element)
      })
    }
  }
  
  // In the end all vdom nodes are plain objects with nodeName, attrs, children etc.
  // However if a node is a custom component (function), call it with state and actions,
  // Which will eventually return plain vdom node objects.
  // Return an empty string if the node value is null or undefined.
  function resolveNode(node) {
    return typeof node === "function"
      ? resolveNode(node(globalState, wiredActions))
      : node != null
        ? node
        : ""
  }
  
  // Function to actually update the real DOM
  function render() {
    skipRender = !skipRender
    
    // Populate the VDom with state and actions
    var node = resolveNode(view)
    
    // If rendering should not be skipped (only 1 render per tick), call the patch function to modify the DOM
    // According to the updated VDOM
    if (container && !skipRender) {
      rootElement = patch(container, rootElement, oldNode, (oldNode = node))
    }

    isRecycling = false
    
    // If there are any lifecycle methods, call them in sequence
    while (lifecycle.length) lifecycle.pop()()
  }
  
  // Only render once per tick. Eg. if state is updated 10 times in a row synchronously, only re-render once
  function scheduleRender() {
    if (!skipRender) {
      skipRender = true
      setTimeout(render)
    }
  }
  
  // Helper function to merge two objects by making a shallow copy
  function clone(target, source) {
    var out = {}

    for (var i in target) out[i] = target[i]
    for (var i in source) out[i] = source[i]

    return out
  }
  
  /* Same as getPartialState (see below), except sets the desired piece of state (by shallow copying),
     Also uses recursion for the nested objects instead of looping */
  function setPartialState(path, value, source) {
    var target = {}
    if (path.length) {
      target[path[0]] =
        path.length > 1
          ? setPartialState(path.slice(1), value, source[path[0]])
          : value
      return clone(source, target)
    }
    return value
  }
  
  /* Gets the desired piece of state from the global state
     path: Array<String>, e.g. var path = ['foo', 'bar'],
     source: Object e.g. var source = { foo: { bar: { someValue: 3 } } }
     getPartialState(path, source) // { someValue: 3 }
  */
  function getPartialState(path, source) {
    var i = 0
    while (i < path.length) {
      source = source[path[i++]]
    }
    return source
  }
  
  /* Generates higher order functions for the provided actions that, when called,
     will update state and schedule re-renders accordingly */
  function wireStateToActions(path, state, actions) {
    // Iterate over the provided action names
    for (var key in actions) {
      typeof actions[key] === "function"
        // Execute an immediately invoked function expression that returns a new function
        // The returned function will then decide on re-renders and state updates
        ? (function(key, action) {
            // reassign the current action to be a higher-order-function
            actions[key] = function(data) {
              // the original action function is called
              var result = action(data)

              if (typeof result === "function") {
                result = result(getPartialState(path, globalState), actions)
              }
              
              // If the actions returns a truthy value that isn't identical to the prev state
              // And isn't a Promise, then update the app state and schedule a re-render
              if (
                result &&
                result !== (state = getPartialState(path, globalState)) &&
                !result.then // !isPromise
              ) {
                scheduleRender(
                  (globalState = setPartialState(
                    path,
                    clone(state, result),
                    globalState
                  ))
                )
              }

              return result
            }
          })(key, actions[key])
        // The actions object might contain namespaced nesting (nested objects)
        // e.g. var actions = { fooActions: { doSomething: function() {} } }
        // So in that case call wireStateToActions recursively on those sub-objects
        : wireStateToActions(
            path.concat(key),
            (state[key] = clone(state[key])),
            (actions[key] = clone(actions[key]))
          )
    }
    
    // Return the new higher order functions that have the ability to update state 
    // and issue re-renders
    return actions
  }
  
  // Safety helper to get a vdom node's key without TypeError risk
  function getKey(node) {
    return node ? node.key : null
  }
  
  // A single event listener is used to delegate all events to handlers
  // event: DOMEvent
  // The return value is the result of a function call to the relevant handler
  function eventListener(event) {
    return event.currentTarget.events[event.type](event)
  }
  
  /* Update the HTML attribute of a given DOM element
     element: DOM element
     name: String, eg. 'style'
     value: String/Number/Object...,
     oldValue: String/Number/Object...,
     isSvg: Boolean (is the element a svg element?)
  */
  function updateAttribute(element, name, value, oldValue, isSvg) {
    // Ignore attributes named 'key', because they are used for the vdom's rendering optimization
    // Not related to the real DOM directly
    if (name === "key") {
    } else if (name === "style") {
      // In case of the style attribute, overwrite oldValue with value (new value)
      // And iterate over each of the style properties
      for (var i in clone(oldValue, value)) {
        // Convert empty property values to an empty string, and then set the style property
        var style = value == null || value[i] == null ? "" : value[i]
        if (i[0] === "-") {
          element[name].setProperty(i, style)
        } else {
          element[name][i] = style
        }
      }
    } else {
      // If the attribute starts with 'on', its an event handler
      if (name[0] === "o" && name[1] === "n") {
        // remove 'on' from the attribute name eg. 'onclick' -> 'click'
        name = name.slice(2)
        
        // Create an 'events' object on the element if not present already
        if (element.events) {
          // if the prop didn't have a specified old value, assign to it the current event
          // eg. oldValue = element.events['click'] (which might also be undefined)
          if (!oldValue) oldValue = element.events[name]
        } else {
          element.events = {}
        }
        
        // Store the event handler in the element's events object
        element.events[name] = value
        
        // If the new value is defined, and no previous eventlistener exists, add it
        if (value) {
          if (!oldValue) {
            element.addEventListener(name, eventListener)
          }
        // If the new value is undefined, remove the current event listener
        } else {
          element.removeEventListener(name, eventListener)
        }
      // For other attributes: if the attribute already exists and the element is not a svg
      // Reassign it to either the value (when defined) or an empty string (when undefined)
      } else if (name in element && name !== "list" && !isSvg) {
        element[name] = value == null ? "" : value
      // If the attribute does not yet exist and the new value is truthy, set the attribute
      } else if (value != null && value !== false) {
        element.setAttribute(name, value)
      }
      
      // If the new value is undefined, null, or false, remove the attribute from the element
      if (value == null || value === false) {
        element.removeAttribute(name)
      }
    }
  }
  
  // Creates a real DOM element from a vdom node
  // node: Object(vdom node)
  // isSvg: Boolean (is the node a representation of an svg element?)
  function createElement(node, isSvg) {
    // If the node is String/Number, create a text node
    var element =
      typeof node === "string" || typeof node === "number"
        ? document.createTextNode(node)
        // If the node is explicitly stated to be a svg, OR if it's nodeName
        // property is 'svg', create a svg element
        : (isSvg = isSvg || node.nodeName === "svg")
          ? document.createElementNS(
              "http://www.w3.org/2000/svg",
              node.nodeName
            )
          // Otherwise create a regular DOM element using the nodeName string (eg. 'div')
          : document.createElement(node.nodeName)
    
    // HTML attributes (plus possibly other custom attrs)
    var attributes = node.attributes
    if (attributes) {
      // If oncreate handler specified, add it to the lifecycle methods array
      if (attributes.oncreate) {
        lifecycle.push(function() {
          attributes.oncreate(element)
        })
      }
      
      // If the vdom node has children specified, call createElement on each of those
      // And append them as real child elements of the current DOM element
      // Use resolveNode to create 'primitive' nodes out of any possible components (i.e. functions)
      for (var i = 0; i < node.children.length; i++) {
        element.appendChild(
          createElement(
            (node.children[i] = resolveNode(node.children[i])),
            isSvg
          )
        )
      }
      
      // For each of the vdom node's specified attributes, call updateAttribute to
      // Make real changes to the DOM element's attributes
      for (var name in attributes) {
        updateAttribute(element, name, attributes[name], null, isSvg)
      }
    }
    
    // Return the real DOM element that was created
    return element
  }
  
  /* Companion to createElement, but operates on an existing DOM element without creating new ones
     element: DOMElement
     oldAttributes: Object (previous HTML attributes)
     attributes: Object (new HTML attributes)
     isSvg: Boolean
  */
  function updateElement(element, oldAttributes, attributes, isSvg) {
    // Override the old attributes with the new ones and iterate over each of them
    for (var name in clone(oldAttributes, attributes)) {
      // Call updateAttribute if the value has changed
      if (
        attributes[name] !==
        (name === "value" || name === "checked"
          ? element[name]
          : oldAttributes[name])
      ) {
        updateAttribute(
          element,
          name,
          attributes[name],
          oldAttributes[name],
          isSvg
        )
      }
    }
    
    // Call oncreate or unupdate depending on whether isRecycling is true
    var cb = isRecycling ? attributes.oncreate : attributes.onupdate
    if (cb) {
      lifecycle.push(function() {
        cb(element, oldAttributes)
      })
    }
  }
  
  /* Recursively remove all child elements from a DOM element
     element: DOM element
     node: Object (vdom node)
  */
  function removeChildren(element, node) {
    var attributes = node.attributes
    if (attributes) {
      for (var i = 0; i < node.children.length; i++) {
        removeChildren(element.childNodes[i], node.children[i])
      }
      
      // Call ondestroy hook if it is specified
      if (attributes.ondestroy) {
        attributes.ondestroy(element)
      }
    }
    return element
  }
   
  /* Remove an element from the DOM
     parent: DOM element (parent to the to-be-removed element)
     element: DOM element
     node: Object (vdom node)
  */
  function removeElement(parent, element, node) {
    function done() {
      parent.removeChild(removeChildren(element, node))
    }

    var cb = node.attributes && node.attributes.onremove
    // If onremove lifecycle hook is specified, call it first
    // Then remove all the child elements, and lastly the main element itself
    if (cb) {
      cb(element, done)
    } else {
      done()
    }
  }
  
  // This is the high-level function that calls createElement, updateElement etc.
  // To actually control the application's re-renders etc.
  // parent: DOMElement (eg. the '#main' container div)
  // element: DOMElement (the one to be added or updated)
  // oldNode: Object (vdom node, previous)
  // node: Object (vdom node, new)
  // isSvg: Boolean
  function patch(parent, element, oldNode, node, isSvg) {
    // If the new node is the exact same object as the old one, do a no-op
    if (node === oldNode) {
    } else if (oldNode == null || oldNode.nodeName !== node.nodeName) {
      // Otherwise in case there is no old node, or the element type has changed (eg. 'span' -> 'div')
      // Create a new element and append it as the parent's child element
      var newElement = createElement(node, isSvg)
      parent.insertBefore(newElement, element)
      
      // If the old node did exist but the node type changed, it needs to be removed
      if (oldNode != null) {
        removeElement(parent, element, oldNode)
      }

      element = newElement
    } else if (oldNode.nodeName == null) { // if node is a text node
      element.nodeValue = node
    } else {
      // Otherwise call updateElement
      updateElement(
        element,
        oldNode.attributes,
        node.attributes,
        (isSvg = isSvg || node.nodeName === "svg")
      )

      var oldKeyed = {}
      var newKeyed = {}
      var oldElements = []
      var oldChildren = oldNode.children
      var children = node.children

      for (var i = 0; i < oldChildren.length; i++) {
        oldElements[i] = element.childNodes[i]

        var oldKey = getKey(oldChildren[i])
        if (oldKey != null) {
          oldKeyed[oldKey] = [oldElements[i], oldChildren[i]]
        }
      }

      var i = 0
      var k = 0

      while (k < children.length) {
        var oldKey = getKey(oldChildren[i])
        var newKey = getKey((children[k] = resolveNode(children[k])))

        if (newKeyed[oldKey]) {
          i++
          continue
        }

        if (newKey != null && newKey === getKey(oldChildren[i + 1])) {
          if (oldKey == null) {
            removeElement(element, oldElements[i], oldChildren[i])
          }
          i++
          continue
        }

        if (newKey == null || isRecycling) {
          if (oldKey == null) {
            patch(element, oldElements[i], oldChildren[i], children[k], isSvg)
            k++
          }
          i++
        } else {
          var keyedNode = oldKeyed[newKey] || []

          if (oldKey === newKey) {
            patch(element, keyedNode[0], keyedNode[1], children[k], isSvg)
            i++
          } else if (keyedNode[0]) {
            patch(
              element,
              element.insertBefore(keyedNode[0], oldElements[i]),
              keyedNode[1],
              children[k],
              isSvg
            )
          } else {
            patch(element, oldElements[i], null, children[k], isSvg)
          }

          newKeyed[newKey] = children[k]
          k++
        }
      }

      while (i < oldChildren.length) {
        if (getKey(oldChildren[i]) == null) {
          removeElement(element, oldElements[i], oldChildren[i])
        }
        i++
      }

      for (var i in oldKeyed) {
        if (!newKeyed[i]) {
          removeElement(element, oldKeyed[i][0], oldKeyed[i][1])
        }
      }
    }
    return element
  }
}
