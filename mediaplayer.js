"use strict";

if (typeof AFRAME === 'undefined') {
	throw 'AFRAME is not loaded.';
}

class ItemList {
	constructor(itemPath, options) {
		this.itemPath = itemPath;
		this.options = options || {};
		this.size = -1;
		this.name = "";
		this.thumbnailUrl = null;

		this.offset = 0;
		this.apiUrl = "../api/";
		this.loadPromise = null;
		this.items = [];
	}
	async init() {
		await this._load(0);
	}
	async get(position) {
		let item = this._getOrNull(position);
		if (item != null) {
			return item;
		}
		if (position < 0 || this.size >= 0 && position >= this.size) throw "Out of Range error.";
		await this._load(Math.max(position - 10, 0));
		return this._getOrNull(position);
	}
	async _load(offset) {
		if (this.loadPromise !== null) return await this.loadPromise;
		this.loadPromise = (async () => {
			let params = "?offset=" + offset;
			if (this.options.orderBy) params += "&orderBy=" + this.options.orderBy;
			if (this.options.order) params += "&order=" + this.options.order;
			let response = await fetch(this.apiUrl + this.itemPath + params);
			if (response.ok) {
				let result = await response.json();
				this.offset = offset;
				this.size = result.total;
				this.items = result.items;
				this.name = result.name || this.itemPath;
				if (!this.thumbnailUrl && result.items[0]) this.thumbnailUrl = result.items[0].thumbnailUrl;
			}
		})();
		try {
			await this.loadPromise;
		} finally {
			this.loadPromise = null;
		}
	}
	_getOrNull(position) {
		if (position < this.offset || position >= this.offset + this.items.length) return null;
		return this.items[position - this.offset];
	}
}

class LocalList {
	constructor(listName, options) {
		this.itemPath = listName;
		this.name = "Favorites";
		this.items = [];
		let s = localStorage.getItem(this.itemPath);
		if (s !== null) {
			this.items = JSON.parse(s);
		}
		if (options && options.orderBy) {
			this._setSort(options.orderBy, options.order);
		}
		this.size = this.items.length;
	}
	init() {
		return this.get(0)
	}
	get(position) {
		return Promise.resolve(this.items[position]);
	}
	addItem(item, storage = null) {
		if (this.contains(item.name)) return;
		this.items.push(item);
		this.size = this.items.length;
		localStorage.setItem(this.itemPath, JSON.stringify(this.items));
	}
	contains(name) {
		return this.items.some(item => item.name === name);
	}
	clear() {
		this.items = [];
		this.size = 0;
		localStorage.removeItem(this.itemPath);
	}
	_getOrNull(position) {
		return this.items[position];
	}
	_setSort(orderBy, order) {
		let r = order === "a" ? 1 : -1;
		if (orderBy === "name") {
			this.items.sort((a, b) => (a.name || "").localeCompare(b.name) * r);
		} else if (orderBy === "updated") {
			this.items.sort((a, b) => (a.updatedTime || "").localeCompare(b.updatedTime) * r);
		}
	}
}

window.storageAccessors = Object.assign(window.storageAccessors || {}, {
	"Favs": {
		name: "Favorites",
		root: "favoriteItems",
		shortcuts: {},
		getList: (folder, options) => new LocalList("favoriteItems", options)
	},
	"MEDIA": {
		name: "Media",
		root: "tags",
		shortcuts: { "All": "tags/_ALL_ITEMS" },
		getList: (folder, options) => new ItemList(folder, options)
	}
});

AFRAME.registerComponent('media-selector', {
	schema: {
		storage: { default: "MEDIA" },
		path: { default: "" }
	},
	init() {
		this.itemlist = new ItemList();
		this.currentPos = -1;
		this.sortOrder = null;
		this.sortBy = null;
		this.item = {};
		var videolist = this._byName('medialist').components.xylist;
		videolist.setCallback(function (parent, data) {
			//console.log("create elem");
			var el = document.createElement('a-plane');
			el.setAttribute("width", 4.0);
			el.setAttribute("height", 1.0);
			el.setAttribute("xyrect", {});
			el.setAttribute("xycanvas", { width: 512, height: 128 });
			return el;
		}, (position, el, data) => {
			var ctx = el.components.xycanvas.canvas.getContext("2d");
			ctx.clearRect(0, 0, 512, 128);

			let prevSise = this.itemlist.size;
			data.get(position).then((item) => {
				if (el.dataset.listPosition != position || item == null) {
					return;
				}
				if (this.itemlist.size != prevSise) {
					videolist.setContents(this.itemlist, this.itemlist.size); // update size
				}

				ctx.font = "24px bold sans-serif";
				ctx.fillStyle = "white";
				ctx.fillText(item.name, 0, 23);
				el.components.xycanvas.updateTexture();

				if (!item.thumbnailUrl) return;
				var image = new Image();
				image.crossOrigin = "anonymous";
				image.referrerPolicy = "origin-when-cross-origin";
				image.onload = function () {
					if (el.dataset.listPosition != position) {
						return;
					}
					var dw = 200, dh = 128 - 24;
					var sx = 0, sy = 0, sw = image.width, sh = image.height;
					if (sh / sw > dh / dw) {
						sy = (sh - dh / dw * sw) / 2;
						sh -= sy * 2;
					}
					ctx.drawImage(image, sx, sy, sw, sh, 0, 24, dw, dh);
					el.components.xycanvas.updateTexture();
				};
				image.src = item.thumbnailUrl;
			});
		});
		videolist.el.addEventListener('clickitem', async (ev) => {
			let pos = ev.detail.index;
			this.currentPos = pos | 0;
			let item = await this.itemlist.get(pos);
			console.log(item);
			if (item.type === "list" || item.type === "tag") {
				this._openList(item.storage, item.path);
			} else if (item.contentType == "directory" || item.contentType == "archive") {
				this._openList(item.storage || this.data.storage, item.path);
			} else {
				this.el.sceneEl.systems["media-player"].playContent(item, this);
			}
		});

		this._byName('storage-button').setAttribute('values', Object.keys(this.system.storageAccessors).join(","));
		this._byName('storage-button').addEventListener('change', ev => {
			// this._openList(ev.detail.value, "");
			this.el.setAttribute('media-selector', { storage: ev.detail.value, path: "" });
		});

		this._byName('fav-button').addEventListener('click', (e) => {
			if (this.item) new LocalList("favoriteItems").addItem(this.item, this.data.storage);
		});
		this._byName('sort-name-button').addEventListener('click', (e) => {
			this.setSort("name", (this.sortBy == "name" && this.sortOrder == "a") ? "d" : "a");
		});
		this._byName('sort-updated-button').addEventListener('click', (e) => {
			this.setSort("updated", (this.sortBy == "updated" && this.sortOrder == "d") ? "a" : "d");
		});
	},
	update() {
		let path = this.data.path;
		console.log("load list: ", path);
		this.item = { type: "list", path: path, name: path };
		this._loadList(path);
	},
	async _openList(storage, path) {
		let mediaList = await instantiate('mediaListTemplate');
		mediaList.setAttribute("media-selector", "path:" + path + (storage ? ";storage:" + storage : ""));
		let pos = new THREE.Vector3().set(this.el.getAttribute("width") * 1 + 0.3, 0, 0);
		mediaList.setAttribute("rotation", this.el.getAttribute("rotation"));
		mediaList.setAttribute("position", this.el.object3D.localToWorld(pos));
		adjustWindowPos(mediaList, true);
	},
	setSort(sortBy, sortOrder) {
		this.sortBy = sortBy;
		this.sortOrder = sortOrder;
		this._loadList(this.itemlist.itemPath);
	},
	_loadList(path) {
		this.currentPos = 0;
		let accessor = this.system.storageAccessors[this.data.storage || "MEDIA"];
		this.itemlist = accessor.getList(path || accessor.root, { orderBy: this.sortBy, order: this.sortOrder });
		this.itemlist.init().then(() => {
			var mediaList = this._byName('medialist').components.xylist;
			mediaList.setContents(this.itemlist, this.itemlist.size);
			this.el.setAttribute("xywindow", "title", this.itemlist.name);
			this.item.name = this.itemlist.name;
			this.item.thumbnailUrl = this.itemlist.thumbnailUrl;
		});
	},
	movePos(d) {
		this.currentPos += d;
		if (this.currentPos >= 0 && this.currentPos < this.itemlist.size) {
			this.itemlist.get(this.currentPos).then(item => {
				let t = item.contentType.split("/")[0];
				if (t == "image" || t == "video" || t == "audio") {
					this.el.sceneEl.systems["media-player"].playContent(item, this);
				} else {
					// skip
					this.movePos(d);
				}
			});
		} else {
			this.currentPos = this.currentPos < 0 ? this.itemlist.size : -1;
		}
	},
	_byName(name) {
		return this.el.querySelector("[name=" + name + "]");
	}
});

AFRAME.registerComponent('media-player', {
	schema: {
		src: { default: "" },
		loop: { default: true },
		playbackRate: { default: 1.0 },
		loadingSrc: { default: "#loading" },
		mediaController: { default: "media-controller" },
		screen: { default: ".screen" }
	},
	init() {
		this.screen = this.el.querySelector(this.data.screen);
		this.touchToPlay = false;
		this.system.registerPlayer(this);

		this.onclicked = ev => this.system.selectPlayer(this);
		this.el.addEventListener('click', this.onclicked);
		this.screen.addEventListener('click', ev => this.togglePause());

		let mediaController = this.data.mediaController;
		this.el.querySelectorAll("[" + mediaController + "]").forEach(controller => {
			controller.components[mediaController].setMediaPlayer(this);
		});

		let showControls = visible => {
			this.el.querySelectorAll("[" + mediaController + "]")
				.forEach(el => el.setAttribute("visible", visible));
			if (this.el.components.xywindow) {
				this.el.components.xywindow.controls.setAttribute("visible", visible);
			}
		}
		showControls(false);
		this.el.addEventListener('mouseenter', ev => { showControls(true); setTimeout(() => showControls(true), 0) });
		this.el.addEventListener('mouseleave', ev => showControls(false));
	},
	update(oldData) {
		if (this.data.src != oldData.src && this.data.src) {
			this.playContent({ url: this.data.src }, null);
		}
		if (this.mediaEl && this.mediaEl.playbackRate !== undefined) {
			this.mediaEl.playbackRate = this.data.playbackRate;
		}
		if (this.mediaEl && this.mediaEl.loop !== undefined) {
			this.mediaEl.loop = this.data.loop;
		}
	},
	resize(width, height) {
		console.log("media size: " + width + "x" + height);
		let maxw = 25, maxh = 25;
		let w = maxw;
		let h = height / width * w;
		if (h > maxh) {
			h = maxh;
			w = width / height * h;
		}
		if (isNaN(h)) {
			h = 3;
			w = 10;
		}

		this.screen.setAttribute("width", w);
		this.screen.setAttribute("height", h);
		this.el.setAttribute("width", w);
		this.el.setAttribute("height", h);
	},
	playContent(f, mediaSelector) {
		this.el.dispatchEvent(new CustomEvent('media-player-play', { detail: { item: f, mediaSelector: mediaSelector } }));
		console.log("play: " + f.url + " " + f.contentType);
		if (this.el.components.xywindow && f.name) {
			this.el.setAttribute("xywindow", "title", f.name);
		}
		this.screen.removeAttribute("material"); // to avoid texture leaks.
		this.screen.setAttribute('material', { shader: "flat", src: this.data.loadingSrc, transparent: false, npot: true });

		var dataElem;
		if (f.contentType && f.contentType.split("/")[0] == "image") {
			dataElem = Object.assign(document.createElement("img"), { crossOrigin: "" });
			dataElem.addEventListener('load', ev => {
				this.resize(dataElem.naturalWidth, dataElem.naturalHeight);
				this.screen.setAttribute('material', { shader: "flat", src: "#" + dataElem.id, transparent: f.url.endsWith(".png"), npot: true });
				this.el.dispatchEvent(new CustomEvent('media-player-loaded', { detail: { item: f, event: ev } }));
			});
		} else {
			dataElem = Object.assign(document.createElement("video"), {
				autoplay: true, controls: false, loop: this.data.loop, id: "dummyid"
			});
			dataElem.addEventListener('loadeddata', ev => {
				dataElem.playbackRate = this.data.playbackRate;
				this.resize(dataElem.videoWidth, dataElem.videoHeight);
				this.screen.setAttribute("src", "#" + dataElem.id);
				this.screen.setAttribute('material', { shader: "flat", src: "#" + dataElem.id, transparent: false });
				this.el.dispatchEvent(new CustomEvent('media-player-loaded', { detail: { item: f, event: ev } }));
			});
			dataElem.addEventListener('ended', ev => {
				this.el.dispatchEvent(new CustomEvent('media-player-ended', { detail: { item: f, event: ev } }));
			});
		}
		dataElem.id = "imageData" + new Date().getTime().toString(16) + Math.floor(Math.random() * 65536).toString(16);
		dataElem.src = f.url;

		// replace
		var parent = (this.mediaEl || document.querySelector(this.data.loadingSrc)).parentNode;
		if (this.mediaEl) this.mediaEl.parentNode.removeChild(this.mediaEl);
		parent.appendChild(dataElem);
		this.mediaEl = dataElem;

		this.touchToPlay = false;
		if (dataElem.play !== undefined) {
			var p = dataElem.play();
			if (p instanceof Promise) {
				p.catch(error => {
					this.touchToPlay = true;
				});
			}
		}
	},
	setStereoMode(idx) {
		let sky = document.querySelector("a-sky");
		if (sky && this.orgsky == null) {
			this.orgsky = sky.getAttribute("src");
		} else if (sky && this.orgsky) {
			document.querySelector("a-sky").setAttribute("src", this.orgsky);
		}
		if (this.screen.hasAttribute("stereo-texture")) {
			this.screen.removeAttribute("stereo-texture");
		}
		if (sky && sky.hasAttribute("stereo-texture")) {
			sky.removeAttribute("stereo-texture");
		}
		if (this.envbox) {
			this.el.sceneEl.removeChild(this.envbox);
			this.envbox.destroy();
			this.envbox = null;
		}
		this.screen.setAttribute("visible", true);
		if (idx == 0) {
		} else if (idx == 1) {
			this.screen.setAttribute("stereo-texture", { mode: "side-by-side" });
		} else if (idx == 2) {
			this.screen.setAttribute("stereo-texture", { mode: "top-and-bottom" });
		} else if (idx == 3) {
			sky.setAttribute("src", "#" + this.mediaEl.id);
			this.screen.setAttribute("visible", false);
		} else if (idx == 4) {
			sky.setAttribute("src", "#" + this.mediaEl.id);
			sky.setAttribute("stereo-texture", { mode: "top-and-bottom" });
			this.screen.setAttribute("visible", false);
		} else if (idx == 5) {
			this.envbox = document.createElement('a-cubemapbox');
			this.envbox.setAttribute("src", "#" + this.mediaEl.id);
			this.envbox.setAttribute("stereo-texture", { mode: "side-by-side" });
			this.el.sceneEl.appendChild(this.envbox);
			this.screen.setAttribute("visible", false);
		}
	},
	togglePause() {
		if (this.mediaEl.tagName == "IMG") {
			return;
		}
		if (this.touchToPlay || this.mediaEl.paused) {
			this.mediaEl.play();
			this.touchToPlay = false;
		} else {
			this.mediaEl.pause();
		}
	},
	remove: function () {
		this.system.unregisterPlayer(this);
		this.screen.removeAttribute("material"); // to avoid texture leaks.
		if (this.mediaEl) this.mediaEl.parentNode.removeChild(this.mediaEl);
		this.el.removeEventListener('click', this.onclicked);
	}
});

AFRAME.registerSystem('media-selector', {
	storageAccessors: window.storageAccessors
});

AFRAME.registerSystem('media-player', {
	shortcutKeys: true,
	init() {
		this.currentPlayer = null;
		document.addEventListener('keydown', ev => {
			if (this.shortcutKeys && !this.currentPlayer) return;
			switch (ev.code) {
				case "ArrowRight":
					this.currentPlayer.mediaSelector.movePos(1);
					break;
				case "ArrowLeft":
					this.currentPlayer.mediaSelector.movePos(-1);
					break;
				case "Space":
					this.currentPlayer.togglePause();
					break;
			}
		});
		setTimeout(() => {
			document.querySelectorAll('[laser-controls]').forEach(el => el.addEventListener('bbuttondown', ev => {
				if (this.currentPlayer) this.currentPlayer.mediaSelector.movePos(-1);
			}));
			document.querySelectorAll('[laser-controls]').forEach(el => el.addEventListener('abuttondown', ev => {
				if (this.currentPlayer) this.currentPlayer.mediaSelector.movePos(1);
			}));
		}, 0);
	},
	async playContent(item, mediaSelector) {
		if (this.currentPlayer === null) {
			(await instantiate('mediaPlayerTemplate')).addEventListener('loaded', e => {
				this.currentPlayer.mediaSelector = mediaSelector;
				this.currentPlayer.playContent(item, mediaSelector);
				adjustWindowPos(this.currentPlayer.el);
			}, false);
		} else {
			this.currentPlayer.mediaSelector = mediaSelector;
			this.currentPlayer.playContent(item, mediaSelector);
		}
	},
	registerPlayer(player) {
		this.selectPlayer(player);
	},
	unregisterPlayer(player) {
		if (player == this.currentPlayer) {
			this.currentPlayer = null;
		}
	},
	selectPlayer(player) {
		this.currentPlayer = player;
	}
});

// UI for MediaPlayer
AFRAME.registerComponent('media-controller', {
	schema: {},
	init() {
		this.player = null;
		this.mediaSelector = null;
		this.continuous = false;
		this.intervalId = null;
		this.continuousTimerId = null;
		this.slideshowInterval = 10000;
		this.videoInterval = 1000;
	},
	remove() {
		clearInterval(this.intervalId);
		clearTimeout(this.continuousTimerId);
	},
	setMediaPlayer(player) {
		// called from media-player
		if (this.player) return;
		this.player = player;
		this.intervalId = setInterval(() => this._updateProgress(), 500);
		var rate = parseFloat(localStorage.getItem('playbackRate'));
		this._updatePlaybackRate(isNaN(rate) ? 1.0 : rate);

		this._byName("playpause").addEventListener('click', ev => this.player.togglePause());
		this._byName("next").addEventListener('click', ev => this.mediaSelector.movePos(1));
		this._byName("prev").addEventListener('click', ev => this.mediaSelector.movePos(-1));
		this._byName("bak10s").addEventListener('click', ev => this.player.mediaEl.currentTime -= 10);
		this._byName("fwd10s").addEventListener('click', ev => this.player.mediaEl.currentTime += 10);
		this._byName("seek").addEventListener('change', ev => this.player.mediaEl.currentTime = ev.detail.value);
		this._byName("loopmode").addEventListener('change', ev => this._setLoopMode(ev.detail.index));
		this._byName("stereomode").addEventListener('change', ev => this._setRenderMode(ev.detail.index));
		this._byName("playbackRate").addEventListener('change', ev => {
			this._updatePlaybackRate(ev.detail.value);
			localStorage.setItem('playbackRate', ev.detail.value.toFixed(1));
		});

		this.player.el.addEventListener('media-player-ended', ev => this._continuousPlayNext(this.videoInterval));
		this.player.el.addEventListener('media-player-play', ev => {
			clearTimeout(this.continuousTimerId);
			this.mediaSelector = ev.detail.mediaSelector;
			this._byName("next").setAttribute('visible', this.mediaSelector != null);
			this._byName("prev").setAttribute('visible', this.mediaSelector != null);
		});
		this.player.el.addEventListener('media-player-loaded', ev => {
			let isVideo = this.player.mediaEl.duration != null;
			this._byName("bak10s").setAttribute('visible', isVideo);
			this._byName("fwd10s").setAttribute('visible', isVideo);
			if (!isVideo && this.continuous) {
				this._continuousPlayNext(this.slideshowInterval);
			}
		});
	},
	_continuousPlayNext(delay) {
		clearTimeout(this.continuousTimerId);
		if (this.mediaSelector) {
			this.continuousTimerId = setTimeout(() => this.continuous && this.mediaSelector.movePos(1), delay);
		}
	},
	_setLoopMode(modeIndex) {
		clearTimeout(this.continuousTimerId);
		if (modeIndex == 0) {
			this.player.el.setAttribute('media-player', 'loop', false);
			this.continuous = false;
		} else if (modeIndex == 1) {
			this.player.el.setAttribute('media-player', 'loop', true);
			this.continuous = false;
		} else {
			this.player.el.setAttribute('media-player', 'loop', false);
			this.continuous = true;
		}
	},
	_setRenderMode(modeIndex) {
		this.player.setStereoMode(modeIndex);
	},
	_updateProgress() {
		if (this.player.mediaEl && this.player.mediaEl.duration) {
			this._byName("seek").setAttribute('max', this.player.mediaEl.duration);
			this._byName("seek").value = this.player.mediaEl.currentTime;
		}
	},
	_updatePlaybackRate(rate) {
		this._byName("playbackRateText").setAttribute("value", rate.toFixed(1));
		this._byName("playbackRate").value = rate;
		this.player.el.setAttribute('media-player', 'playbackRate', rate);
	},
	_byName(name) {
		return this.el.querySelector("[name=" + name + "]");
	}
});


AFRAME.registerComponent('xycanvas', {
    schema: {
        width: { default: 16 },
        height: { default: 16 }
    },
    init() {
        this.canvas = document.createElement("canvas");

        // to avoid texture cache conflict in a-frame.
        this.canvas.id = "_CANVAS" + Math.random();
        let src = new THREE.CanvasTexture(this.canvas);
        this.updateTexture = () => {
            src.needsUpdate = true;
        };

        this.el.setAttribute('material', { shader: "flat", npot: true, src: src, transparent: true });
    },
    update() {
        this.canvas.width = this.data.width;
        this.canvas.height = this.data.height;
    }
});

AFRAME.registerComponent('stereo-texture', {
	schema: {
		mode: { default: "side-by-side", oneOf: ["side-by-side", "top-and-bottom"] },
		swap: { default: false }
	},
	init() {
		this._componentChanged = this._componentChanged.bind(this);
		this._checkVrMode = this._checkVrMode.bind(this);
		this.el.addEventListener('componentchanged', this._componentChanged, false);
		this.el.sceneEl.addEventListener('enter-vr', this._checkVrMode, false);
		this.el.sceneEl.addEventListener('exit-vr', this._checkVrMode, false);
	},
	update() {
		this._reset();
		if (this.el.getObject3D("mesh") === null) return;
		let luv = this._makeObj(1, "stereo-left").geometry.getAttribute("uv");
		let ruv = this._makeObj(2, "stereo-right").geometry.getAttribute("uv");
		let d = this.data.swap ? 0.5 : 0;
		if (this.data.mode == "side-by-side") {
			luv.setArray(luv.array.map((v, i) => i % 2 == 0 ? v / 2 + d : v));
			ruv.setArray(ruv.array.map((v, i) => i % 2 == 0 ? v / 2 + 0.5 - d : v));
		} else if (this.data.mode == "top-and-bottom") {
			luv.setArray(luv.array.map((v, i) => i % 2 == 1 ? v / 2 + 0.5 - d : v));
			ruv.setArray(ruv.array.map((v, i) => i % 2 == 1 ? v / 2 + d : v));
		}
		luv.needsUpdate = true;
		ruv.needsUpdate = true;

		this.el.getObject3D("mesh").visible = false;
		this._checkVrMode();
	},
	remove() {
		this.el.removeEventListener('componentchanged', this._componentChanged, false);
		this.el.sceneEl.removeEventListener('enter-vr', this._checkVrMode, false);
		this.el.sceneEl.removeEventListener('exit-vr', this._checkVrMode, false);
		this._reset();
	},
	_checkVrMode() {
		let leftObj = this.el.getObject3D("stereo-left");
		if (leftObj != null) {
			this.el.sceneEl.is('vr-mode') ? leftObj.layers.disable(0) : leftObj.layers.enable(0);
		}
	},
	_makeObj(layer, name) {
		let obj = this.el.getObject3D("mesh").clone();
		obj.geometry = obj.geometry.clone();
		obj.layers.set(layer);
		this.el.setObject3D(name, obj);
		return obj;
	},
	_reset() {
		if (this.el.getObject3D("stereo-left") != null) {
			this.el.getObject3D("mesh").visible = true;
			this.el.removeObject3D("stereo-left");
			this.el.removeObject3D("stereo-right");
		}
	},
	_componentChanged(ev) {
		if (ev.detail.name === 'geometry' || ev.detail.name === 'material') {
			this.update();
		}
	}
});

AFRAME.registerGeometry('cubemapbox', {
	// TODO: eac https://blog.google/products/google-ar-vr/bringing-pixels-front-and-center-vr-video/
	schema: {
		height: { default: 1, min: 0 },
		width: { default: 1, min: 0 },
		depth: { default: 1, min: 0 },
		eac: { default: false }
	},
	init(data) {
		let d = 0.001;
		let uv = [[
			new THREE.Vector2(d, 1), // px
			new THREE.Vector2(.5 - d, 1),
			new THREE.Vector2(.5 - d, 2.0 / 3),
			new THREE.Vector2(d, 2.0 / 3),
		], [
			new THREE.Vector2(d, 1.0 / 3),  // nx
			new THREE.Vector2(.5 - d, 1.0 / 3),
			new THREE.Vector2(.5 - d, 0),
			new THREE.Vector2(d, 0),
		], [
			new THREE.Vector2(1 - d, 1), // py
			new THREE.Vector2(1 - d, 2.0 / 3),
			new THREE.Vector2(.5 + d, 2.0 / 3),
			new THREE.Vector2(.5 + d, 1),
		], [
			new THREE.Vector2(1 - d, 1.0 / 3), // ny
			new THREE.Vector2(1 - d, 0),
			new THREE.Vector2(.5 + d, 0),
			new THREE.Vector2(.5 + d, 1.0 / 3),
		], [
			new THREE.Vector2(1 - d, 2.0 / 3), // pz
			new THREE.Vector2(1 - d, 1.0 / 3),
			new THREE.Vector2(.5 + d, 1.0 / 3),
			new THREE.Vector2(.5 + d, 2.0 / 3),
		], [
			new THREE.Vector2(d, 2.0 / 3), // nz
			new THREE.Vector2(.5 - d, 2.0 / 3),
			new THREE.Vector2(.5 - d, 1.0 / 3),
			new THREE.Vector2(d, 1.0 / 3),
		]];
		let geometry = new THREE.BoxGeometry(data.width, data.height, data.depth);
		for (let i = 0; i < 6; i++) {
			geometry.faceVertexUvs[0][i * 2] = [uv[i][0], uv[i][1], uv[i][3]];
			geometry.faceVertexUvs[0][i * 2 + 1] = [uv[i][1], uv[i][2], uv[i][3]];
		}
		this.geometry = geometry;
	}
});


AFRAME.registerPrimitive('a-cubemapbox', {
	defaultComponents: {
		material: { side: 'back', fog: false, shader: 'flat' },
		geometry: { primitive: 'cubemapbox', width: 200, height: 200, depth: 200 },
	},
	mappings: {
		src: 'material.src',
		width: 'geometry.width',
		height: 'geometry.height',
		depth: 'geometry.depth',
	}
});



AFRAME.registerComponent('atlas', {
	schema: {
		src: { default: "" },
		index: { default: 0 },
		cols: { default: 1 },
		rows: { default: 1 },
		margin: { default: 0.01 }
	},
	update() {
		let u = (this.data.index % this.data.cols + this.data.margin) / this.data.cols;
		let v = (this.data.rows - 1 - Math.floor(this.data.index / this.data.cols) + this.data.margin) / this.data.rows;
		this.el.setAttribute("material", {
			shader: 'msdf2',
			transparent: true,
			repeat: { x: 1 / this.data.cols - this.data.margin, y: 1 / this.data.rows - this.data.margin },
			src: this.data.src
		});
		this.el.setAttribute("material", "offset", { x: u, y: v });
	},
});

AFRAME.registerShader('msdf2', {
	schema: {
		diffuse: { type: 'color', is: 'uniform', default: "#ffffff" },
		opacity: { type: 'number', is: 'uniform', default: 1.0 },
		src: { type: 'map', is: 'uniform' },
		offset: { type: 'vec2', is: 'uniform', default: { x: 0, y: 0 } },
		repeat: { type: 'vec2', is: 'uniform', default: { x: 1, y: 1 } },
		msdfUnit: { type: 'vec2', is: 'uniform', default: { x: 0.1, y: 0.1 } },
	},
	init: function (data) {
		this.attributes = this.initVariables(data, 'attribute');
		this.uniforms = THREE.UniformsUtils.merge([this.initVariables(data, 'uniform'), THREE.UniformsLib.fog]);
		this.material = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: this.vertexShader,
			fragmentShader: this.fragmentShader,
			flatShading: true,
			fog: true
		});
	},
	vertexShader: `
	#define USE_MAP
	#define USE_UV
	#include <common>
	#include <uv_pars_vertex>
	#include <color_pars_vertex>
	#include <fog_pars_vertex>
	#include <clipping_planes_pars_vertex>
	uniform vec2 offset;
	uniform vec2 repeat;
	void main() {
		vUv = uv * repeat + offset;
		#include <color_vertex>
		#include <begin_vertex>
		#include <project_vertex>
		#include <worldpos_vertex>
		#include <clipping_planes_vertex>
		#include <fog_vertex>
	}`,
	fragmentShader: `
	#extension GL_OES_standard_derivatives : enable
	uniform vec3 diffuse;
	uniform float opacity;
	uniform vec2 msdfUnit;
	uniform sampler2D src;
	#define USE_MAP
	#define USE_UV
	#include <common>
	#include <color_pars_fragment>
	#include <uv_pars_fragment>
	#include <fog_pars_fragment>
	#include <clipping_planes_pars_fragment>
	float median(float r, float g, float b) {
		return max(min(r, g), min(max(r, g), b));
	}
	void main() {
		#include <clipping_planes_fragment>
		vec4 sample = texture2D( src, vUv );
		float sigDist = median(sample.r, sample.g, sample.b) - 0.5;
		sigDist *= dot(msdfUnit, 0.5/fwidth(vUv));

		vec4 diffuseColor = vec4( diffuse, opacity * clamp(sigDist + 0.5, 0.0, 1.0));
		#include <color_fragment>
		#include <alphatest_fragment>
		gl_FragColor = diffuseColor;
		#include <fog_fragment>
	}`
});
