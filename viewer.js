/*
 * (C) 2009 Andrzej Zaborowski <balrogg@gmail.com>
 * Code under GNU Public License version 2 or version 3 at your option.
 */

/*
 * Viewer
 */
function treeviewer(element) {
	this.display = element;
	this.location = "";
	this.data = "";
	this.tips = {};
	this.rules = {};
	this.helper = {};

	this.watch("location", function(prop, oldval, newval) {
			if (!newval.length) {
				this.unload();
				return newval;
			}

			this.display.innerHTML = "Loading a forest...";
			var this_obj = this;
			if (request_tree(newval, function(r) {
						this_obj.load(r);
					}, function(err) {
						this_obj.location = "";
						this_obj.display.innerHTML =
							err;
					}))
				return newval;

			return oldval;
		});

	this.watch("data", function(prop, oldval, newval) {
			if (!newval) {
				this.unload();
				return newval;
			}

			this.display.innerHTML = "Loading a forest...";
			this.load(newval);
			return newval;
		});

	this.general = document.getElementById("generalinfo");
	this.popup = document.getElementById("generalinfo");

	this.display.style.overflow = "hidden";

	/* We overwrite user's settings.  This is because there's no way
	 * to easily retrieve actual client area with padding on, in DOM,
	 * without rewriting part of the rendering engine... with no padding,
	 * clientWidth (in pixels) == style.width and children absolute
	 * position are relative to clientLeft.  Not knowing that, we
	 * would need to create another div inside this.display and make
	 * sure it has no non-default style set with .style.cssText = ""
	 * perhaps? */
	this.display.style.padding = "0px";
}

var forests = [];
var forest_id = 0;
treeviewer.prototype.unload = function() {
	this.anim_cancel();

	if (this.blackboard) {
		this.blackboard.removeChild(this.image);
		this.display.removeChild(this.blackboard);
		if (this.ruler)
			this.display.removeChild(this.ruler);

		if (this.startnode)
			this.startnode.hide(this);

		/* Unref */
		delete this["image"];
		delete this["blackboard"];
		if (this.ruler)
			delete this["ruler"];
	}

	if (this.id in forests)
		delete forests[this.id];
	if (this.startnode)
		delete this["startnode"];
	if (this.nodes)
		delete this["nodes"];

	this.popup_hide();

	/* TODO: detach */
}

treeviewer.prototype.load = function(input) {
	if (!input.forest && input.packet && input.packet.name) {
		var menu = "<h2>Packet " + input.packet.name.to_xml_safe() +
			"</h2> contains:<br /><p>\n";

		if (input.packet.forest)
			for (var fnum in input.packet.forest) {
				forest = input.packet.forest[fnum];
				/* TODO: use onclick to set location */
				menu += "<a href=\"" +
					window.location.pathname + "?" +
					forest.file + "\">Forest " +
					forest.file.to_xml_safe() +
					"</a><br />\n";
			}

		menu += "</p>";
		this.display.innerHTML = menu;

		return;
	}

	if (this.helper.prepare)
		this.helper.prepare(input);

	var forest = input;
	if (input.forest)
		forest = input.forest;
	if (!forest.stats || !forest.text) {
		this.location = "";
		this.display.innerHTML = "Couldn't parse input";
		return;
	}

	this.unload();

	if (this.popup_on_init)
		this.set_general_info(forest);
	this.forest = forest;
	if (!forest.startnode || !parseInt(forest.stats.trees)) {
		this.display.innerHTML = "";
		return;
	}

	if (forest.node.from)
		forest.node = [ forest.node ]; /* Ugly work-around */

	/* Locate the start node */
	this.startnode = null;
	this.nodes = {};
	if (!forest.startnode.label)
		forest.startnode.label = forest.startnode["#text"];

	try {
		for (var nnum in forest.node) {
			var node = new forestnode(forest.node[nnum]);
			this.nodes[node.nid] = node;

			if (node.terminal && node.to != node.from + 1)
				throw "terminal spans multiple lexemes (" +
					(node.from + 1) + " - " + node.to + ")";

			if ("nid" in forest.startnode)
				continue;
			if (node.nonterminal && node.nonterminal.category ==
					forest.startnode.label &&
				node.from == forest.startnode.from &&
				node.to == forest.startnode.to) {
				if (this.startnode)
					throw "multiple start nodes present";

				this.startnode = node;
			}
		}
		if ("nid" in forest.startnode)
			this.startnode = this.nodes[forest.startnode.nid];

		if (!this.startnode)
			throw "no start nodes present";
		this.startnode.set_default_tree(this);
	} catch (e) {
		this.display.innerHTML = "Can't parse: " + e;
		return;
	}

	/* From here on, we should be independent of input format */

	this.widths = new Array(this.startnode.to);
	this.columns = new Array(this.startnode.to + 1);
	/* For now all columns have equal widths */

	for (var i = this.startnode.from; i < this.startnode.to; i ++)
		this.widths[i] = 1.0;

	this.columns[this.startnode.from] = 0;
	for (var i = this.startnode.from + 1; i <= this.startnode.to; i ++)
		this.columns[i] = this.columns[i - 1] + this.widths[i - 1];

	this.graph_ns = "http://www.w3.org/2000/svg";

	this.blackboard = document.createElement("div");
	this.image = document.createElementNS(this.graph_ns, "svg");
	this.blackboard.className = "blackboard";
	this.blackboard.style.position = "absolute";
	if (!this.noruler) {
		this.ruler = document.createElement("div");
		this.ruler.className = "ruler";
		this.ruler.style.position = "absolute";
	}

	var scale = get_style(".nodecircle").style.width;
	if (scale.ends_in("%"))
		this.scale = this.display.clientWidth * parseInt(scale) * 0.01;
	else
		this.scale = parseInt(scale);
	this.nodeheight = 50.0 / this.scale;

	this.nodebgcolour = get_style(".nodecircle").style.backgroundColor;

	var this_obj = this;
	attach(this.display, "mousedown",
			function(evt) { this_obj.down(evt); }, true);
	attach(document, "mouseup",
			function(evt) { this_obj.up(evt); }, false);
	attach(document, "mousemove",
			function(evt) { this_obj.move(evt); }, false);

	this.html_left = 0;
	this.html_top = 0;

	/* Should not matter */
	this.image.setAttributeNS(null, "preserveAspectRatio", "none");

	this.startnode.update_depth();
	this.startnode.place(0, this);

	this.step = 100;
	this.anim_update();

	this.show();

	this.blackboard.appendChild(this.image);
	this.display.innerHTML = "";
	this.display.appendChild(this.blackboard);
	if (this.ruler)
		this.display.appendChild(this.ruler);

	/* TODO: must do this whenever this.display is resized
	 * (must also adjust this.html_left, this.html_top) */
	this.rulerheight = (this.ruler ? this.ruler.offsetHeight : 0);
	if (!this.fixed_height)
		this.display.style.height = (this.html_height +
				this.rulerheight) + "px";
	this.visibleheight = this.display.clientHeight - this.rulerheight;
	if (this.ruler)
		this.ruler.style.top = this.visibleheight + "px";
	/* Note ruler must have no margin and blackboard must have no
	 * margin padding or border for that to work. */

	if (this.variablewidth) {
		for (var i = this.startnode.from; i <= this.startnode.to; i ++)
			this.columns[i] = 0;
		if (!("horiz_space" in this))
			this.horiz_space = 10;
		this.startnode.relayout(this);
		/* TODO: only until relayout learns setting x1 */
		this.startnode.place(0, this);
		this.step = 100;
		this.anim_update();
		this.show(this);
	}

	/* Center */
	if (this.html_width < this.display.clientWidth) {
		this.html_left = (this.display.clientWidth -
				this.html_width) / 2;
		this.update_viewbox(0);
	}

	this.id = forest_id ++;
	forests[this.id] = this;
}

treeviewer.prototype.show = function() {
	var svg_left = this.columns[this.startnode.from];
	var svg_right = this.columns[this.startnode.to];
	var svg_top = 0;
	var svg_bottom = this.nodeheight *
		(this.startnode.depth[1] + this.startnode.depth[3] * 0.5);

	this.html_width = this.scale *
		(this.columns[this.startnode.to] -
		 this.columns[this.startnode.from]);
	this.html_height = svg_bottom * this.scale;

	this.image.style.width = Math.round(this.html_width) + "px";
	this.image.style.height = Math.round(this.html_height) + "px";
	this.update_viewbox(1);
	this.image.setAttributeNS(null, "viewBox", "" +
			svg_left + " " + svg_top + " " +
			(svg_right - svg_left) + " " +
			(svg_bottom - svg_top));

	if (this.ruler)
		this.startnode.show_ruler(this); /* TODO: only when needed! */
	this.startnode.show(this);
}

treeviewer.prototype.anim_update = function() {
	/* TODO: add inertia? */
	var p = 100.0 - this.step;
	p *= p * 0.0001;
	p = 1.0 - p;

	function node_done(node) {
		node.x = node.x1;
		node.y = node.y1;
		node.animating = 0;
		if (node.leaf)
			return;

		for (var chnum in node.children[node.current].child)
			node_done(node.children[node.current].child[chnum]);
	}

	function node_update_animating(node) {
		node.x = node.x1;
		node.y = node.y1;
		if (!node.animating)
			node.opacity = "" + p;
		if (node.leaf)
			return;

		for (var chnum in node.children[node.current].child)
			node_update_animating(
				node.children[node.current].child[chnum]);
	}

	function node_update(node) {
		if (node.animating) {
			node_update_animating(node);
			return;
		}

		/* Seems more stable than x1 * p + x0 * (1 - p) */
		node.x = node.x0 + (node.x1 - node.x0) * p;
		node.y = node.y0 + (node.y1 - node.y0) * p;
		if (node.leaf)
			return;

		for (var chnum in node.children[node.current].child)
			node_update(node.children[node.current].child[chnum]);
	}

	if (this.step < 100)
		node_update(this.startnode);
	else
		node_done(this.startnode);

	this.anim_timer = null;
	if (this.step < 100)
		this.anim_sched();
}

treeviewer.prototype.anim_cancel = function() {
	if (this.anim_timer) { /* Note: racy */
		clearTimeout(this.anim_timer);
		this.anim_timer = null;
	}
}

treeviewer.prototype.anim_sched = function() {
	this.anim_cancel();

	var this_obj = this;
	this_obj.anim_timer = setTimeout(function() {
			this_obj.step += 10;
			this_obj.anim_update();
			this_obj.show(); }, 50);
}

treeviewer.prototype.anim_start = function() {
	function node_update(node) {
		node.x0 = node.x;
		node.y0 = node.y;
		if (node.leaf)
			return;

		for (var chnum in node.children[node.current].child)
			node_update(node.children[node.current].child[chnum]);
	}

	this.anim_cancel();
	node_update(this.startnode);

	this.step = 0;
	this.anim_sched();
}

treeviewer.prototype.update_viewbox = function(size, x, y) {
	if (x == null)
		x = this.html_left;
	if (y == null)
		y = this.html_top;

	this.blackboard.style.left = Math.round(x) + "px";
	this.blackboard.style.top = Math.round(y) + "px";
	if (this.ruler)
		this.ruler.style.left = this.blackboard.style.left;
	if (size) {
		this.blackboard.style.width =
			Math.round(this.html_width) + "px";
		this.blackboard.style.height =
			Math.round(this.html_height) + "px";
		if (this.ruler)
			this.ruler.style.width = this.blackboard.style.width;
	}
}

treeviewer.prototype.popup_show = function(style, x, y) {
	if (x == null)
		x = this.display.offsetLeft + "px";
	else
		x = Math.round(this.display.offserLeft +
				this.display.clientLeft +
				this.html_left + x * this.scale) + "px";
	if (y == null)
		y = "30%"
	else
		y = Math.round(this.display.offsetTop +
				this.display.clientTop +
				this.html_top + y * this.scale) + "px";

	this.popup.style.position = "absolute";
	this.popup.style.left = x;
	this.popup.style.top = y;
	this.popup.className = style;
	this.popup.style.visibility = "visible";
	this.popped = true;
}

treeviewer.prototype.popup_hide = function() {
	this.popped = false;
	if (this.popup)
		this.popup.style.visibility = "hidden";
}

treeviewer.prototype.popup_update = function() {
	this.popped = this.popup.style.visibility == "visible";
}

treeviewer.prototype.set_general_info = function(forest) {
	this.general.innerHTML = "<p>The input was \"" +
		forest.text.to_xml_safe() + "\".</p>\n";
	this.general.innerHTML += "<p>Processing took " +
		("" + forest.stats.cputime).to_xml_safe() + " seconds.</p>\n";
	if (forest.stats.trees > 1)
		this.general.innerHTML += "<p>" +
			forest.stats.trees + " trees generated.</p>\n";
	else if (forest.stats.trees == 1)
		this.general.innerHTML += "<p>Parser produced a single " +
			"tree.</p>\n";
	else
		this.general.innerHTML += "<p>Parsing failed.</p>\n";

	this.general.innerHTML += "<p><a href=\"#\">Tree View</a> | " +
			"<a href=\"#\">Spreadsheet View</a></p>\n";

	this.popup_show("general");
}

treeviewer.prototype.down = function(evt) {
	if (evt.preventDefault)
		evt.preventDefault();
	else
		evt.returnValue = false;

	this.popup_update();
	this.pop = !this.over && !this.popped;
	if (this.over && !this.popped) {
		clearTimeout(this.over.popup_timer);
		this.timeout();
	} else if (this.popped)
		this.popup_hide();

	this.down_x = parseInt(evt.pageX);
	this.down_y = parseInt(evt.pageY);

	this.moving = true;
}

treeviewer.prototype.up = function(evt) {
	if (!this.moving)
		return;
	this.moving = false;

	var dx = parseInt(evt.pageX) - this.down_x;
	var dy = parseInt(evt.pageY) - this.down_y;

	if ((dx == 0 && dy > -2 && dy < 2) || (dy == 0 && dx > -2 && dx < 2)) {
		if (this.pop)
			this.set_general_info(this.forest);
		return;
	}

	this.html_left += dx;
	this.html_top += dy;

	if (this.html_left < this.display.clientWidth - this.html_width)
		this.html_left = this.display.clientWidth - this.html_width;
	if (this.html_top < this.visibleheight - this.html_height)
		this.html_top = this.visibleheight - this.html_height;

	if (this.html_width < this.display.clientWidth)
		this.html_left = (this.display.clientWidth -
				this.html_width) / 2;
	else if (this.html_left > 0)
		this.html_left = 0;
	if (this.html_top > 0)
		this.html_top = 0;

	this.update_viewbox();
}

treeviewer.prototype.move = function(evt) {
	if (evt.preventDefault)
		evt.preventDefault();
	else
		evt.returnValue = false;

	if (!this.moving)
		return;

	var x = parseInt(evt.pageX);
	var y = parseInt(evt.pageY);

	x = this.html_left + x - this.down_x;
	y = this.html_top + y - this.down_y;

	if (x < this.display.clientWidth - this.html_width)
		x = this.display.clientWidth - this.html_width;
	if (y < this.visibleheight - this.html_height)
		y = this.visibleheight - this.html_height;

	if (this.html_width < this.display.clientWidth)
		x = (this.display.clientWidth - this.html_width) / 2;
	else if (x > 0)
		x = 0;
	if (y > 0)
		y = 0;

	this.update_viewbox(0, x, y);
}

treeviewer.prototype.highlight = function(re) {
	for (var forest in forests)
		forests[forest].startnode.highlight(re);
}

treeviewer.prototype.add_tips = function(tips) {
	/*this.tips = this.tips.concat(tips);*/
	for (var tip in tips)
		this.tips[tip] = tips[tip];
}

treeviewer.prototype.add_rules = function(rules) {
	var re = /s\([a-z0-9_]+\)/;
	for (var i in rules) {
		var matches = rules[i].match(re);
		if (!matches)
			continue;
		var pos = rules[i].indexOf("s(");
		var end = rules[i].substr(pos).indexOf(")");
		if (pos > -1 && end > -1)
			this.rules[rules[i].substr(pos + 2, end - 2)] =
				rules[i];
	}
}

/*
 * Forest node
 */
function forestnode(inputnode) {
	for (var prop in inputnode)
		if (prop[0] != '#')
			this[prop] = inputnode[prop];

	if (!("attrs" in this))
		this.attrs = {};
	if (!("attrs_order" in this)) {
		this.attrs_order = [];
		for (var attr in this.attrs)
			this.attrs_order.push(attr);
	}

	if (this.terminal && this.terminal.length)
		this.terminal = this.terminal[0];

	if (!("space" in this))
		this.space = 0.0;

	if (this.terminal) {
		this.leaf = true;
		if (this.subtrees == 1)
			return;

		throw "Wrong subtrees number at a leaf " +
			this.label + " with nid " + this.nid;
	}

	if (!this.children)
		throw "Non-leaf node with no children found: " +
			this.label + ", nid " + this.nid;

	if (this.children.child)
		this.children = [ this.children ];
	else if (!this.children.length)
		throw "Non-leaf with no children found: " +
			this.label + ", nid " + this.nid;
}

forestnode.prototype.set_default_tree = function(forest) {
	if (!("current" in this))
		this.current = 0;

	for (var rulenum in this.children) {
		/* Note: could convert node.children to a rule => child
		 * dictionary.  */
		if (this.children[rulenum].child.nid)
			this.children[rulenum].child =
				[ this.children[rulenum].child ];

		for (var chnum in this.children[rulenum].child) {
			var nid = this.children[rulenum].child[chnum].nid;
			if (!(nid in forest.nodes))
				throw "Referred node " + nid + " not found";

			var subnode = forest.nodes[nid];
			this.children[rulenum].child[chnum] = subnode;
			subnode.set_default_tree(forest);
		}
	}
}

forestnode.prototype.update_depth = function() {
	var space = (this.hidden ? 0 : 0.5) + this.space;
	if (this.leaf) {
		if (this.incomplete)
			space += 0.5;
		this.depth = [ space, space, space, 0 ];
		return;
	}

	this.depth = [ 0x1000, -1, space, -1 ]
	for (var chnum in this.children[this.current].child) {
		var subnode = this.children[this.current].child[chnum];

		subnode.update_depth();

		if (subnode.depth[0] + space < this.depth[0])
			this.depth[0] = subnode.depth[0] + space;
		if (subnode.depth[1] + space > this.depth[1])
			this.depth[1] = subnode.depth[1] + space;
		if (subnode.depth[3] + 1 > this.depth[3])
			this.depth[3] = subnode.depth[3] + 1;
	}
}

/* TODO: rename these two as horiz layout and vert layout */
forestnode.prototype.place = function(y, forest) {
	var height = forest.nodeheight * 0.5;

	this.x1 = (forest.columns[this.from] + forest.columns[this.to]) * 0.5;
	this.y1 = y * forest.nodeheight + height * 0.5;
	if (this.hidden) {
		if (this.terminal)
			/* Hidden terminals are at ruler cells */
			this.y1 = forest.nodeheight *
				(forest.startnode.depth[1] +
					forest.startnode.depth[3] * 0.5);
		else
			this.y1 -= height;
	}

	if (this.leaf)
		return;

	y += this.depth[2] + (forest.startnode.depth[1] +
			forest.startnode.depth[3] * 0.5 - y -
			this.depth[1]) / this.depth[3];
	for (var chnum in this.children[this.current].child)
		this.children[this.current].child[chnum].place(y, forest);
}

/* A smarter version of this could have different width spaces between
 * columns, basically there would be a left x and right x value for
 * every column and some smarter logic.. (various possible things to do
 * there.  */
forestnode.prototype.relayout = function(forest) {
	if (!this.leaf)
		/* Note this assumes left-to-right order */
		for (var chnum in this.children[this.current].child)
			this.children[this.current].child[chnum].relayout(
					forest);

	if (!this.elem && !this.ruler)
		return;

	var subwidth = forest.columns[this.to] - forest.columns[this.from];
	var width = this.elem ? this.elem.offsetWidth : 0;
	if (this.ruler) {
		var rwidth = this.ruler_span.offsetWidth;
		if (rwidth > width)
			width = rwidth;
	}
	width += forest.horiz_space; /* TODO: should use a css property */
	width = width * 1.0 / forest.scale;

	if (subwidth >= width)
		return;
	if (subwidth < 0.001) {
		forest.columns[this.to] = forest.columns[this.from] + width;
		return;
	}

	for (var c = this.from + 1; c <= this.to; c ++)
		forest.columns[c] = forest.columns[this.from] +
			(forest.columns[c] - forest.columns[this.from]) *
			width / subwidth;
}

forestnode.prototype.update_info = function(onover, onout, onwheel) {
	var text = this.terminal ? "\"" + this.terminal.base + "\"" :
			this.nonterminal.category;
	this.info.innerHTML = "";

	this.elem = document.createElement("span");
	this.elem.innerHTML = text.to_xml_safe();
	this.elem.className =
		this.terminal ? "terminal-node" : "nonterminal-node";

	this.info.appendChild(this.elem);
	attach(this.elem, "mouseover", onover, false);
	attach(this.elem, "mouseout", onout, false);

	if (!this.children)
		return;

	var rulename = "";
	if (this.children[this.current].rule)
		rulename = this.children[this.current].rule.to_xml_safe();

	/* TODO: use images */
	var left = this.current ? "&lt;" : " ";
	var right = this.current < this.children.length - 1 ? "&gt;" : " ";

	var rule = document.createElement("span");
	rule.className = "rule";
	rule.innerHTML = left + " " + rulename + " " + right;
	this.info.appendChild(document.createElement("br"));
	this.info.appendChild(rule);

	attach(rule, "DOMMouseScroll", onwheel, false);
}

forestnode.prototype.highlight = function(re) {
	if (this.graph) {
		/* TODO: Use stylesheet classes instead */
		var match = this.attrs[re[0]] && this.attrs[re[0]].match(re[1]);
		/*this.elem.style.color = match ? "white" : "black";*/
		this.graph.setAttributeNS(null, "stroke-width",
				match ? 0.05 : 0);
	}

	if (this.leaf)
		return;

	for (var chnum in this.children[this.current].child)
		this.children[this.current].child[chnum].highlight(re);
}

var separators = "() ,:;[]";
forestnode.prototype.popup_fill = function(forest) {
	forest.popup.innerHTML = "";

	var str = "";
	var prev;
	var add = function(txt, re) {
		str = "";

		var span = document.createElement("span");
		span.innerHTML = txt.to_xml_safe();

		if (prev == -1 || prev == false) {
			/* TODO: replace all chars with \\xXY ?
			 * Note we can't use \\b because non-ASCII letters
			 * are incorrectly treated as non-word characters.
			 */
			if (re[1])
				re[1] = new RegExp("([\\[\\( ,:;]|^)" +
						re[1].replace(".", "\\.") +
						"([\\]\\[\\(\\) ,:;]|$)");
			attach(span, "mouseover", function(evt) {
						forest.highlight(re);
						span.style.color = "white";
					}, false);
			attach(span, "mouseout", function(evt) {
						forest.highlight([ "" ]);
						span.style.color = "black";
					}, false);
		}

		forest.popup.appendChild(span);
	}
	for (var num in this.attrs_order) {
		var name = this.attrs_order[num];
		prev = -1;
		add(name, [ name, "" ], true);
		forest.popup.appendChild(document.createTextNode(": "));

		var label = this.attrs[name];
		for (var c = 0; c < label.length; c ++) {
			var sep = separators.indexOf(label[c]) > -1;
			if (sep != prev && prev != -1)
				add(str, [ name, str ]);
			prev = sep;
			str += label[c];
		}
		add(str, [ name, str ]);

		forest.popup.appendChild(document.createElement("br"));
	}

	if (forest.helper.popup_info) {
		var userinfo = document.createElement("div");
		forest.helper.popup_info(this, userinfo, forest);
		forest.popup.appendChild(userinfo);
		return;
	}

	if (this.leaf)
		return;

	for (var i in forest.tips) {
		var match = 0;
		for (var j in forest.tips[i])
			if (forest.tips[i][j] == this.nonterminal.category)
				match = 1;
		if (!match)
			continue;

		var tip = document.createElement("p");
		tip.className = "tip";
		tip.innerHTML = i.to_xml_safe();
		forest.popup.appendChild(tip);
		break;
	}

	if (!this.children || !this.children[this.current].rule)
		return;

	if (!(this.children[this.current].rule in forest.rules))
		return;
	var rule = forest.rules[this.children[this.current].rule];
	var pre = document.createElement("pre");
	pre.innerHTML = rule.to_xml_safe();
	forest.popup.appendChild(pre);
}

forestnode.prototype.show_ruler = function(forest) {
	if (this.leaf) {
		var left = Math.round(forest.columns[this.from] * forest.scale);
		var right = Math.round(forest.columns[this.to] * forest.scale);
		if (!this.ruler) {
			function node_orth(node) {
				if (node.terminal)
					return node.terminal.orth;

				var chld = node.children[0].child;
				var orth = "";
				for (var chnum in chld) {
					var sub = node_orth(chld[chnum]);
					if (".,".indexOf(sub[0]) == -1 && orth)
						orth += " ";
					orth += sub;
				}
				return orth;
			}

			this.ruler = document.createElement("div");
			this.ruler.className = "lexeme";
			this.ruler.style.position = "absolute";

			this.ruler_span = document.createElement("span");
			if (forest.helper.update_ruler_info)
				forest.helper.update_ruler_info(this);
			else
				this.ruler_span.innerHTML =
					node_orth(this).to_xml_safe();

			this.ruler.appendChild(this.ruler_span);
			forest.ruler.appendChild(this.ruler);
		}

		this.ruler.style.left = left + "px";
		this.ruler.style.width = (right - left) + "px";

		return;
	}

	for (var chnum in this.children[this.current].child)
		this.children[this.current].child[chnum].show_ruler(forest);
}

forestnode.prototype.show = function(forest) {
	/* Note: all the constants in this function are arbitrary numbers
	 * taken out of thin air.  Change them to try to improve the
	 * tree's appearance.  */
	var maxwidth = forest.columns[this.to] - forest.columns[this.from];
	var width = maxwidth * 0.9;
	if (width < 0.9)
		width = 0.9;
	var height = forest.nodeheight * 0.5;

	if (!this.graph && !this.hidden) {
		this.graph = document.createElementNS(forest.graph_ns,
				"ellipse");
		this.graph.setAttributeNS(null, "stroke-width", 0);
		this.graph.setAttributeNS(null, "stroke", "black");
		this.graph.setAttributeNS(null, "fill", forest.nodebgcolour);

		forest.image.appendChild(this.graph);
	}
	if (this.graph) {
		this.graph.setAttributeNS(null, "cx", this.x);
		this.graph.setAttributeNS(null, "cy", this.y);
		this.graph.setAttributeNS(null, "rx", width * 0.5);
		this.graph.setAttributeNS(null, "ry", height * 0.5);
	}

	if (!this.info && !this.hidden) {
		this.info = document.createElement("div");
		this.info.className = "nodelabel";
		this.info.style.position = "absolute";

		var this_obj = this;
		var onafter = function() {
			this_obj.popup_timer = null;
			this_obj.popup_fill(forest);

			forest.popup_show(this_obj.terminal ? "terminal" :
					"nonterminal", this_obj.x, this_obj.y);
		}
		var onover = function(evt) {
			forest.over = this_obj;
			if (this.moving)
				return;

			forest.timeout = onafter;
			this_obj.popup_timer = setTimeout(onafter, 1000);
		}
		var onout = function(evt) {
			forest.over = null;
			if (!this_obj.popup_timer)
				return;

			clearTimeout(this_obj.popup_timer);
			this_obj.popup_timer = null;
		}
		var onwheel = function(evt) {
			this_obj.wheel(evt, forest);
		}
		if (forest.helper.update_node_info)
			forest.helper.update_node_info(this, onover, onout,
				onwheel, function() {
					forest.over = null;
					forest.popup_hide();
				});
		else
			this.update_info(onover, onout, onwheel);

		forest.blackboard.appendChild(this.info);
	}
	if (this.info) {
		this.info.style.left =
			Math.round((this.x - maxwidth * 0.5) *
				forest.scale) + "px";
		this.info.style.top =
			Math.round((this.y - height * 0.3) *
				forest.scale) + "px";
		this.info.style.width =
			Math.round(maxwidth * forest.scale) + "px";
		this.info.style.height =
			Math.round(forest.nodeheight * (1 + this.space)
					* forest.scale) + "px";
		if (this.opacity)
			this.info.style.opacity = this.opacity;
	}

	if (this.leaf) {
		/* TODO: set position */
		if (this.incomplete && !this.decoration) {
			this.decoration = new Array();
			var y = this.y + height * 0.6;
			for (var i = 0; i < 6; i ++) {
				var w = 0.05 / (i + 1);
				var x = width * (0.2 + 0.035 * i);
				var deco = document.createElementNS(
						forest.graph_ns, "line");

				y += w * 0.5;
				deco.setAttributeNS(null, "stroke-width", w);
				deco.setAttributeNS(null, "fill", "none");
				deco.setAttributeNS(null, "stroke",
						forest.nodebgcolour);
				deco.setAttributeNS(null, "x1", this.x - x);
				deco.setAttributeNS(null, "y1", y);
				deco.setAttributeNS(null, "x2", this.x + x);
				deco.setAttributeNS(null, "y2", y);
				y += w * 0.5 + 0.015;

				forest.image.appendChild(deco);
				this.decoration.push(deco);
			}
		}
		return;
	}

	var left = 0;
	var right = 0;

	for (var chnum in this.children[this.current].child) {
		if (this.children[this.current].child[chnum].x > this.x + 0.01)
			right ++;
		if (this.children[this.current].child[chnum].x < this.x - 0.01)
			left ++;
	}

	var yoff = this.children[this.current].child[0].y - this.y;
	var xs = -left; /* TODO: assumes left-to-right iteration */
	var ys = 0;
	if (left > right &&
		left + right < this.children[this.current].child.length)
		xs ++;
	else if (left == right &&
		left + right == this.children[this.current].child.length)
		xs += 0.5;
	var head = this.children[this.current].head != undefined ?
			this.children[this.current].head : -1;
	for (var chnum in this.children[this.current].child) {
		var child = this.children[this.current].child[chnum];
		child.show(forest);

		var xoff = child.x - this.x;
		if (xoff > 0.01)
			ys =-- right;

		var x0 = xs * 0.07;
		var x1 = xoff * 0.45;
		var x2 = xoff * 0.92;
		var x3 = xoff * 0.98;
		var y0 = height * 0.4;
		var y1 = height * 0.15 + ys * 0.03;
		var y2 = height * 0.2 + ys * 0.03;
		var y3 = forest.nodeheight * 0.45 - y2 - y1;
		var y4 = yoff - height;

		var path =
			/* First move a little straight south */
			"0," + y1 + " " +
			/* Then turn in the direction of child node */
			(x1 - x0) + "," + y2 + " " +
			/* Now we should be just above it, turn down again */
			(x2 - x1) + "," + y3 + " " + (x3 - x2) + "," + y4;

		if (Math.abs(x3 - x0) < Math.abs(y2))
			path = "0," + y1 + " " +
				(x3 - x0) + "," + (y2 + y3 + y4);

		if (!child.link) {
			child.link = document.createElementNS(forest.graph_ns,
					"path");
			child.link.setAttributeNS(null, "stroke-width", 0.05);
			child.link.setAttributeNS(null, "fill", "none");
			child.link.setAttributeNS(null, "stroke",
					forest.nodebgcolour);

			forest.image.appendChild(child.link);

			if (chnum == head) {
				child.linkhead = document.createElement("div");
				child.linkhead.className = "head";
				child.linkhead.style.position = "absolute";
				child.linkhead.innerHTML = "&#9660;";
				forest.blackboard.appendChild(child.linkhead);
/*				child.link.setAttributeNS(null,
						"id", "w" + child.nid);
				child.linkhead = document.createElementNS(
						forest.graph_ns, "text");
				child.linkhead.setAttributeNS(null,
						"fill", "black");
				child.linkhead.setAttributeNS(null,
						"font-size", "20");
				child.linkhead.setAttributeNS(null,
						"font-family", "Verdana");

				var tp = document.createElementNS(
						forest.graph_ns, "textPath");
				tp.setAttributeNS(
						"http://www.w3.org/1999/xlink",
						"xlink:href", "#w" + child.nid);
				tp.appendChild(document.createTextNode(
						"Hello!&#9664;"));
				child.linkhead.appendChild(tp);

				forest.image.appendChild(child.linkhead);
*/
			}
		}

		child.link.setAttributeNS(null, "d", "M" +
			/* Start shifted in the direction of the child node */
			(this.x + x0) + "," + (this.y + y0) + " t" + path);

		//	/* Start shifted in the direction of the child node */
		//	(this.x + xoff * 0.1) + "," + (this.y + height * 0.2) +
		//	/* First move a little straight south */
		//	" t" + (xoff * 0.1) + "," + (height * 0.3) + " " +
		//	/* Then turn in the direction of child node (horiz) */
		//	(xoff * 0.4) + "," + (forest.nodeheight * 0.2) + " " +
		//	/* Now we should be just above it, turn down again */
		//	(xoff * 0.35) + "," + (forest.nodeheight * 0.25));

		if (child.linkhead) {
			child.linkhead.style.left =
				Math.round((child.x - 0.2) *
					forest.scale) + "px";
			child.linkhead.style.top =
				Math.round((child.y - height) *
					forest.scale) + "px";
			child.linkhead.style.width =
				Math.round(forest.scale * 0.4) + "px";
		}

		if (xoff < -0.01)
			ys += 1.0;
		xs += 1.0;
	}
}

forestnode.prototype.hide = function(forest) {
	if (this.graph) {
		forest.image.removeChild(this.graph);
		delete this["graph"];
	}

	if (this.link) {
		forest.image.removeChild(this.link);
		delete this["link"];

		if (this.linkhead) {
			forest.blackboard.removeChild(this.linkhead);
			delete this["linkhead"];
		}
	}

	if (this.info) {
		forest.blackboard.removeChild(this.info);
		delete this["elem"];
		if (this.rule)
			delete this["rule"];
		delete this["info"];
	}

	if (this.ruler) {
		forest.ruler.removeChild(this.ruler);
		delete this["ruler"];
		delete this["ruler_span"];
	}

	if (this.terminal)
		return;

	for (var chnum in this.children[this.current].child)
		this.children[this.current].child[chnum].hide(forest);
}

forestnode.prototype.nopopup = function() {
	forest.over = null;
}

forestnode.prototype.wheel = function(evt, forest) {
	if (evt.preventDefault)
		evt.preventDefault();
	else
		evt.returnValue = false;

	var delta = 0;
	if (!evt)		/* For IE. */
		evt = window.event;
	if (evt.wheelDelta) {	/* IE/Opera. */
		delta = evt.wheelDelta / 120;
		if (window.opera)
			delta = delta * 2;
	} else if (evt.detail)	/* Mozilla case. */
		delta = -evt.detail / 3;

	var newsubtree;
	if (delta < 0 && this.current < this.children.length - 1)
		newsubtree = this.current + 1;
	else if (delta > 0 && this.current)
		newsubtree = this.current - 1;
	else
		return;

	forest.anim_update();
	forest.anim_cancel();
	/* (Race) */

	this.hide(forest);
	this.current = newsubtree;
	this.animating = 1;

	for (var i = forest.startnode.from; i <= forest.startnode.to; i ++)
		forest.columns[i] = 0;
	forest.startnode.update_depth();
	forest.startnode.place(0, forest);
	forest.startnode.relayout(forest); /* TODO: needs to be animated */

	function node_update(node) {
		node.x = node.x1;
		node.y = node.y1;
		if (!node.animating)
			node.opacity = "0";
		if (node.terminal)
			return;

		for (var chnum in node.children[node.current].child)
			node_update(node.children[node.current].child[chnum]);
	}
	node_update(this);

	forest.anim_start();
	forest.show();
}

/*
 * Utils
 */
String.prototype.to_xml_safe = function() {
	return this.replace(/&/g, "&amp;").replace(/</g, "&lt;").
		replace(/>/g, "&gt;");
}

String.prototype.ends_in = function(ending) {
	return this.substr(this.length - ending.length) == ending;
}

function dump(arr, nl, tab, level) {
	if (!level)
		level = "";
	if (!nl)
		nl = "\n";
	if (!tab)
		tab = "  ";

	if (typeof(arr) == 'object' && 'length' in arr) {
		var text = "[" + nl;
		for (var item in arr)
  			text += level + tab +
				dump(arr[item], nl, tab, level + tab) +
				"," + nl;
		return text + level + "]";
	} else if (typeof(arr) == 'object') {
		var text = "{" + nl;
		for (var item in arr)
  			text += level + tab + item + ": " +
				dump(arr[item], nl, tab, level + tab) + nl;
		return text + level + "}";
	} else
		return "" + arr + " (" + typeof(arr) + ")";
}

function dump_json(arr, nl, tab, level) {
	if (!level)
		level = "";
	if (!nl)
		nl = "\n";
	if (!tab)
		tab = "  ";

	if (typeof(arr) == 'object' && 'length' in arr) {
		var text = "[" + nl;
		for (var item in arr)
  			text += level + tab +
				dump_json(arr[item], nl, tab, level + tab) +
				"," + nl;
		return text + level + "]";
	} else if (typeof(arr) == 'object') {
		var text = "{" + nl;
		for (var item in arr) {
			if (item == "#text")
				continue;
  			text += level + tab + "\"" + item + "\": " +
				dump_json(arr[item], nl, tab, level + tab) +
				"," + nl;
		}
		return text + level + "}";
	} else if (typeof(arr) == 'string')
		return "\"" + arr + "\"";
	else
		return "" + arr;
}

/* This really shouldn't be here... */
var ints = {
	"nid": 1, "from": 1, "to": 1, "subtrees": 1,
	"trees": 1, "nodes": 1, "inferences": 1
};

function parse_xml(xml) {
	var children = {};
	var count = 0;

	if (xml.nodeName == "#text")
		return xml.nodeValue;

	/* "in" doesn't work here */
	for (var chnum = 0; chnum < xml.childNodes.length; chnum ++) {
		var item = xml.childNodes[chnum];
		var name = item.nodeName;

		if (!(name in children)) {
			children[name] = [];
			count ++;
		}

		var val = parse_xml(item);
		if (typeof(val) == "string" && name in ints)
			val = parseInt(val);
		children[name].push(val);
	}
	if (xml.attributes)
		for (var chnum = 0; chnum < xml.attributes.length; chnum ++) {
			var item = xml.attributes[chnum];
			var name = item.nodeName;

			if (!(name in children)) {
				children[name] = [];
				count ++;
			}

			if (name in ints)
				children[name].push(parseInt(item.nodeValue));
			else
				children[name].push(item.nodeValue);
		}

	for (var chname in children)
		if (children[chname].length == 1)
			children[chname] = children[chname][0];

	if (count == 1 && children["#text"])
		return children["#text"];

	return children;
}

var interp = { ",": 1, ".": 1 };
function parse_text(text) {
	var words = [];
	var word = "";

	for (var i = 0; i < text.length; i ++) {
		var chr = text[i];

		if (!(chr in whitespace || chr in interp)) {
			word += chr;
			continue;
		}

		if (word != "") {
			words.push(word);
			word = "";
		}

		if (chr in interp)
			words.push(chr);
	}

	return words;
}

function get_style(name) {
	for (var stnum in document.styleSheets) {
		var rules;
		if (document.styleSheets[stnum].cssRules)
			rules = document.styleSheets[stnum].cssRules;
		else
			rules = document.styleSheets[stnum].rules;

		for (var rulenum in rules)
			if (rules[rulenum].selectorText == name)
				return rules[rulenum];
	}
}

function attach(obj, evt, fn, capt) {
	if (obj.addEventListener) {
		if (navigator.appName.indexOf("Netscape") == -1)
			if (evt == "DOMMouseScroll")
				evt = "mousewheel";
		if (navigator.userAgent.indexOf("Safari") != -1) {
			if (evt == "DOMMouseScroll")
				obj.onmousewheel = fn;
			else
				obj.addEventListener(evt, fn, capt);
		} else
			obj.addEventListener(evt, fn, capt);
	} else {
		if (evt == "DOMMouseScroll")
			obj.attachEvent("onmousewheel", fn);
		else
			obj.attachEvent("on" + evt, fn);
	}
};

function eval_json(str) {
	var ret;
	eval("ret = " + str);
	return ret;
}

/*
 * File loader
 * (TODO: Try to support JSON-P)
 */
var c = function(value) { return value; }
var cq = [];
function request_tree(treeurl, cb, err_cb, data) {
	var http_request;
	var xml = treeurl.ends_in(".xml");
	var mime = xml ? "text/xml" : "text/plain";

	if (window.XMLHttpRequest) { /* Mozilla, webkit,... */
		http_request = new XMLHttpRequest();
		if (http_request.overrideMimeType)
			http_request.overrideMimeType(mime);
	} else if (window.ActiveXObject) { /* IE */
		try {
			http_request = new ActiveXObject("Msxml2.XMLHTTP");
		} catch (e) {
			try {
				http_request =
					new ActiveXObject("Microsoft.XMLHTTP");
			} catch (e) {}
		}
	}
	if (!http_request) {
		alert("I couldn\'t make no XMLHttp object :-(");
		return false;
	}

	http_request.onreadystatechange = function() {
		if (http_request.readyState != 4)
			return;

		if (http_request.status == 200) {
			var resp = xml ?
				parse_xml(http_request.responseXML) :
				http_request.responseText.substr(0, 2) == "c(" ?
				eval(http_request.responseText) :
				eval_json(http_request.responseText);

			if (data)
				cb(resp, data);
			else
				cb(resp);
			return;
		}

		/* TODO: handle the error (retry? display error
		 * in a non-obtrusive text field?) */
		/* TODO: or fall back to JSON-P immediately? */

		err_cb("Error " + http_request.status +
			" reading the forest description");

		if (http_request.status == 0) {
			/* TODO: switch to JSON-P mode */
		}
	}
	http_request.open('GET', treeurl, true);
	http_request.send(null);

	return http_request;
}
