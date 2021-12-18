interface Dict<T> { [key: string]: T }

export function h(type: string | Function, props: any = {}, ...content: any) {
	if (type === '#text') return new VNode(type, null, content.join())
	return new VNode(type, props, content.flat(Infinity).map(c => typeof c === 'string' ? new VNode('#text', null, c) : c))
}

export class VNode {
	type: string | any
	props: Dict<any> = {}
	parent: VNode
	$el: HTMLElement | Text
	children: VNode[] = []
	nodeValue: string
	evtListeners: Dict<Set<Function>> = {}
	component?: any
	static = false

	constructor(type: string | any, props: Dict<any>, children: VNode[] | string = []) {
		this.type = type
		if (type !== '#text') {
			for (const key in props) {
				if (key.startsWith('on')) {
					const evtName = key.slice(2).toLowerCase()
					this.evtListeners[evtName] = this.evtListeners[evtName] || new Set<Function>()
					this.evtListeners[evtName].add(props[key])
				} else
					this.props[key] = props[key]
			}
			(children as VNode[]).forEach(c => { if(c instanceof VNode) this.append(c) })
		} else
			this.nodeValue = children as string
	}

	append(child: VNode) {
		child.parent = this
		this.children.push(child)
	}

	createElement() {
		if (this.type instanceof Function) {
			// TODO: Inefficient and dirty
			this.component = new this.type(this.props, this.children)
			this.$el = this.component.createMountpoint() // This is a wasteful render. Need to know parent of this.$el here in order to patch properly
			// this.component.mount(this.$el)
			return this.$el
		}

		if (this.type === '#text') {
			this.$el = document.createTextNode(this.nodeValue)
			return this.$el
		}

		this.$el = document.createElement(this.type) as HTMLElement

		for (const propName in this.props) if (propName !== 'style' || typeof this.props['style'] === 'string')
			this.$el.setAttribute(propName, this.props[propName])

		if ('style' in this.props && this.props['style'] instanceof Object)
			Object.assign(this.$el.style, this.props['style'])

		for (const evtType in this.evtListeners)
			this.evtListeners[evtType].forEach(f => this.$el.addEventListener(evtType, f as any))

		this.children.forEach(c => this.$el.appendChild(c.createElement()))

		return this.$el
	}
}
