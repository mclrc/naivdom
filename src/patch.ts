import { VNode } from './vnode'


export function diff(vold: VNode, vnew: VNode, index = -1): Function[] {
	if (!vold) // Node is new, create new element
		return [($el, $parent) => insertOrAppend($parent, vnew.createElement(), index)]
	else if (!vnew) // Node has been removed, remove DOM node
		return [$el => $el.remove()]
	else if (!isSameVNode(vold, vnew)) // Nodes correspond to different elements. Replace old with new DOM node
		return [($el, $parent = $el?.parentElement) => { $el.remove(); insertOrAppend($parent, vnew.createElement(), index) }]

	// Both nodes describe the same element. Determine necessary changes

	// Transcribe information onto newly rendered node
	vnew.$el = vold.$el
	vnew.component = vold.component

	// Static nodes don't change bewteen renders
	if (vnew.static) return []

	// List of necessary changes
	const patches = [
		...diffListeners(vold, vnew)
	]

	if (typeof vnew.type === 'string') // If the node is not a component, diff both props and children
		patches.push(...diffProps(vold, vnew), ...diffChildren(vold, vnew))
	else // Components take care of children and DOM props themselves. Update component props
		patches.push(() => {
			Object.assign(vnew.component.props, vnew.props)
		})

	// Elements with keys might move inbetween renders. Make sure they're in the right place
	// TODO: Repositions elements unecessarily if their index has lowered
	if (index >= 0 && 'key' in vnew.props) patches.push(($el, $parent = $el?.parentElement) => {
		// console.log(index, Array.from($parent.childNodes))
		if ($parent?.childNodes[index] !== vold.$el) {
			$el.remove()
			insertOrAppend($parent, $el, index)
		}
	})

	return patches
}

export function diffChildren(vold: VNode, vnew: VNode): Function[] {
	const patches = []

	// Create key->node map for nodes from old tree for O(1) access
	const oldKeyPool = new Map<any, VNode>()
	vold.children.forEach(vn => {
		if ('key' in vn.props) oldKeyPool.set(vn.props['key'], vn)
	})

	// Two pointers, one for each tree
	let oldCur = 0
	let newCur = 0
	while (oldCur < vold.children.length || newCur < vnew.children.length) { // While there are nodes left to process...

		const oldChild = vold.children[oldCur]
		const newChild = vnew.children[newCur]

		if (newChild && 'key' in newChild.props) { // If the new node has a key...
			// Try finding the old corresponding node
			const oldCorrespondingNode = oldKeyPool.get(newChild.props['key'])
			if (oldCorrespondingNode) {
				// If there is one, diff them against each other
				const diffs = diff(oldCorrespondingNode, newChild, newCur)
				// TODO: always happens
				if (diffs.length) // If changes need to be made, create a patch
					patches.push($el => patch(oldCorrespondingNode?.$el, diffs))
				// Remove old node from pool
				oldKeyPool.delete(newChild.props['key'])
				// Advance cursor and proceed to next node
				newCur++
				continue
			}
		}
		if (oldChild && 'key' in oldChild.props) {
			// Old nodes with a key will either be diffed with the corresponding new node or removed. So, move past them
			oldCur++
			continue
		}
		// If neither node has a key, diff them against each other
		const diffs = diff(oldChild, newChild, newCur)

		if (diffs.length) // Create patch if necessary
			patches.push($el => patch(oldChild?.$el, diffs, vold.$el as HTMLElement))

		// Advance both cursors
		oldCur++
		newCur++
	}

	if (oldKeyPool.size) // If the pool still contains nodes at this point, there are no new corresponding nodes. The elements can be removed
		patches.unshift($el => oldKeyPool.forEach(vn => vn.$el.remove()))
	return patches
}

export function diffProps(vold: VNode, vnew: VNode): Function[] {
	const patches = [...diffStyle(vold, vnew)]

	const props = new Set([...Object.keys(vold.props), ...Object.keys(vnew.props)])
	props.delete('style')
	
	// Loop all props present on either node
	props.forEach(prop => {
		if (!(prop in vnew.props)) // If the new node does not have the prop, create a patch to remove it
			patches.push($el => $el.removeAttribute(prop))

		if (vold.props[prop] !== vnew.props[prop]) // Create a patch to update the value of props present on the new node, if they have changed
			patches.push($el => {
				$el.setAttribute(prop, vnew.props[prop])
				$el[prop] = vnew.props[prop]
			})
	})
	return patches
}

function applyStyle($el: HTMLElement, style: string | Object) {
	if (!style) return

	if (typeof style === 'string') $el.setAttribute('style', style)
	else
		for (const key in style) $el.style[toCamelCase(key)] = style[key]
}

function removeStyle($el: HTMLElement, style: string | Object) {
	if (!style) return

	if (typeof style === 'string') $el.removeAttribute('style')
	else
		for (const key in style) delete $el.style[toCamelCase(key)]
}

export function diffStyle(vold: VNode, vnew: VNode): Function[] {
	const oldStyle = vold.props['style']
	const newStyle = vnew.props['style']

	// If both styles are the same, there is no need to patch anything.
	// This patch could be more efficient
	return compare(oldStyle, newStyle) ? [] : [$el => {
		removeStyle($el, oldStyle)
		applyStyle($el, newStyle)
	}]
}

export function diffListeners(vold: VNode, vnew: VNode): Function[] {
	const patches = []

	// Loop through every type of event either node has listeners for
	makeUnique([...Object.keys(vold.evtListeners), ...Object.keys(vnew.evtListeners)]).forEach(evtType => {
		const oldSet = vold.evtListeners[evtType]
		const newSet = vnew.evtListeners[evtType]

		if (!(evtType in vold.evtListeners)) // Create patches to add listeners for new event types
			patches.push($el => newSet.forEach(f => $el.addEventListener(evtType, f as any)))
		else if (!(evtType in vnew.evtListeners)) // Or remove listeners for event types no longer listened for
			patches.push($el => oldSet.forEach(f => $el.removeEventListener(evtType, f as any)))
		else {
			// If the type of event has listeners on both nodes, diff them individually
			oldSet.forEach(f => {
				if (!newSet.has(f)) // Remove all listeners not present in the new set
					patches.push($el => $el.removeEventListener(evtType, f as any))
			})
			newSet.forEach(f => {
				if (!oldSet.has(f)) // Add all listeners not present in the old set
					patches.push($el => $el.addEventListener(evtType, f as any))
			})
		}
	})
	return patches
}

// Simple helper to apply patches to an element
export function patch($el: HTMLElement | Text, diffs: Function[], $parent = $el?.parentElement) {
	// Save active element
	const focussed = document.activeElement as HTMLElement
	// Apply patches
	diffs.forEach(d => d($el, $parent))
	// Refocus active element to make sure it retains focus should it have moved
	focussed.focus()
}

// Determines if an old element can be used/recycled for a new node
export function isSameVNode(a: VNode, b: VNode): boolean {
	// If both nodes are text nodes, their values have to match up
	// If they have keys, those need to match
	// They have to be of the same type
	return (
		!(a.type === '#text' && a.nodeValue !== b.nodeValue) &&
		(a.props['key']) === (b.props['key']) &&
		a.type === b.type
	)
}

// Inserts an element at a specific index into the parent, or appends it if the index is out of bounds or <0
function insertOrAppend(
	$parent: HTMLElement,
	$el: HTMLElement | Text,
	index: number
): HTMLElement | Text {
	if (index >= $parent.childNodes.length || index < 0)
		$parent.appendChild($el)
	else
		$parent.insertBefore($el, $parent.childNodes[index])

	return $el
}

// Converts kebap-case to camelCase. Used to convert style names from css to js case (background-color -> backgroundColor)
function toCamelCase(source: string): string {
	return source.replace(/-(.)/g, (m, g1) => g1.toUpperCase())
}

// Removes duplicates from source array
function makeUnique(source: Array<any>) {
	return Array.from(new Set(source))
}

// Performs deep comparison of two objects. Prototypes and methods are ignored
function compare(a: Object, b: Object) {
	return JSON.stringify(a) === JSON.stringify(b)
}
