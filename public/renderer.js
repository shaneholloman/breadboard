class App {
  constructor (query, sync, sorter_code) {
    this.init_rpc()
    this.query = query
    this.sorter_code = sorter_code
    this.sync_mode = sync
    this.checkpoints = { }
    this.selection = new Selection(this)
    this.navbar = new Navbar(this);
    this.handler = new Handler(this);
    this.bar = new Nanobar({
      //target: document.querySelector(".container")
      //target: document.querySelector("body")
      target: document.querySelector("#bar")
    });
  }
  async init () {
    console.log("INIT", VERSION)
    this.selector = new TomSelect("nav select", {
      onDropdownClose: () => {
        this.selector.blur()
      }
    })
    await this.init_db()
    try {
      let current_version = await this.db.settings.where({ key: "version" }).first()
      if (current_version.val === VERSION) {
        await this.init_theme()
        await this.init_zoom()
        this.init_worker()
        if (this.sync_mode === "true" || this.sync_mode === "reindex") {
          await this.synchronize()
        } else {
          await this.draw()
        }
      } else {

//        await this.db.files.clear()
//        await this.db.checkpoints.clear()
        await this.db.delete()    // only for this version => from next version will be upgraded



        await this.init_db()
        await this.bootstrap_db()
        await this.init_theme()
        await this.init_zoom()
        this.init_worker()
        if (this.sync_mode === "true" || this.sync_mode === "reindex") {
          await this.synchronize()
        } else {
          await this.draw()
        }
      }
    } catch (e) {
//      await this.db.files.clear()
//      await this.db.checkpoints.clear()
      await this.db.delete()
      await this.init_db()
      await this.bootstrap_db()
      await this.init_theme()
      await this.init_zoom()
      this.init_worker()
      if (this.sync_mode === "true" || this.sync_mode === "reindex") {
        await this.synchronize()
      } else {
        await this.draw()
      }
    }
  }
  async insert (o) {
    let tokens = []
    let wordSet = {}
    if (o.prompt && typeof o.prompt === 'string' && o.prompt.length > 0) {
      wordSet = o.prompt.split(' ')
      .map((x) => {
        return this.stripPunctuation(x)
      })
      .reduce(function (prev, current) {
        if (current.length > 0) prev[current] = true;
        return prev;
      }, {});
    }
    if (o.subject) {
      for(let k of o.subject) {
        wordSet["tag:" + k] = true
      }
    }
    tokens = Object.keys(wordSet);

    await this.db.files.put({ ...o, tokens })

    if (this.checkpoints[o.root_path]) {
      if (this.checkpoints[o.root_path] < o.btime) {
        await this.updateCheckpoint(o.root_path, o.btime)
      }
    } else {
      let cp = await this.db.checkpoints.where({ root_path: o.root_path }).first()   
      if (cp) {
        if (cp < o.btime) {
          await this.updateCheckpoint(o.root_path, o.btime)
        }
      } else {
        await this.updateCheckpoint(o.root_path, o.btime)
      }
    }
  }
  async checkpoint (root_path) {
    let cp = await this.db.checkpoints.where({ root_path }).first()
    if (cp) return cp.btime
    else return null
  }
  async updateCheckpoint (root_path, btime) {
    let cp = await this.db.checkpoints.put({ root_path, btime })
    this.checkpoints[root_path] = btime
  }
  init_rpc() {
    window.electronAPI.onMsg(async (_event, value) => {
      if (value.$type === "synchronize") {
        await this.synchronize()
      } else if (value.$type === "update") {
        this.navbar.notification(value)
      } else {
        queueMicrotask(async () => {
          if (value.meta) {
            let response = await this.insert(value.meta).catch((e) => {
              console.log("ERROR", e)
            })
          }
          this.sync_counter++;
          if (this.sync_counter === value.total) {
            this.sync_complete = true
          }
          let ratio = value.progress/value.total
          this.bar.go(100*value.progress/value.total);
        })
      }
    })
  }
  async init_db () {
    this.db = new Dexie("breadboard")
    this.db.version(1).stores({
      files: "file_path, agent, model_name, root_path, prompt, btime, mtime, *tokens",
      folders: "&name",
      checkpoints: "&root_path, btime",
      settings: "key, val",
      favorites: "query"
    })
    await this.persist()
  }
  async persist() {
    if (!navigator.storage || !navigator.storage.persisted) {
      return "never";
    }
    let persisted = await navigator.storage.persisted();
    if (persisted) {
      return "persisted";
    }
    if (!navigator.permissions || !navigator.permissions.query) {
      return "prompt"; // It MAY be successful to prompt. Don't know.
    }
    const permission = await navigator.permissions.query({
      name: "persistent-storage"
    });
    if (permission.state === "granted") {
      persisted = await navigator.storage.persist();
      if (persisted) {
        return "persisted";
      } else {
        throw new Error("Failed to persist");
      }
    }
    if (permission.state === "prompt") {
      return "prompt";
    }
    return "never";
  }
  async init_zoom () {
    let zoom = await this.db.settings.where({ key: "zoom" }).first()
    if (zoom) {
      window.electronAPI.zoom(zoom.val)
    }
  }
  async bootstrap_db () {
    let defaults = await window.electronAPI.defaults()
    for(let d of defaults) {
      await this.db.folders.put({ name: d }).catch((e) => { })
    }
    await this.db.settings.put({ key: "version", val: VERSION })
  }
  async init_theme () {
    this.theme = await this.db.settings.where({ key: "theme" }).first()
    if (!this.theme) this.theme = { val: "default" }
    document.body.className = this.theme.val
  }
  init_worker () {
    this.worker = new Worker("./worker.js")
  //  clusterize = new Clusterize({
  //    scrollElem: document.querySelector(".container"),
  //    contentElem: document.querySelector(".content"),
  //    rows_in_block: 500,
  //    blocks_in_cluster: 10
  //  });



  //  ds = new DragSelect({
  //    selectables: document.querySelectorAll('.card'),
  //    area: document.querySelector(".content"),
  //    draggability: false,
  //  });
  //  ds.subscribe('callback', async (e) => {
  //    if (e.items && e.items.length > 0) {
  //      // reset tags
  //      updateSelection(e.items)
  //    } else {
  //      selectedEls = []
  //      document.querySelector("footer").classList.add("hidden")
  //    }
  //  });
    this.worker.onmessage = async (e) => {
      await this.fill(e.data)
      setTimeout(() => {
  //      if (clusterize) {
  //        clusterize.destroy(true)
  //      } else {
  //        clusterize = new Clusterize({
  //          scrollElem: document.querySelector(".container"),
  //          contentElem: document.querySelector(".content"),
  //          rows_in_block: 500,
  //          blocks_in_cluster: 10
  //        });
  //      }
//        console.time("clusterize")
//    this.clusterize = new Clusterize({
////      rows: data,
//      scrollElem: document.querySelector(".container"),
//      contentElem: document.querySelector(".content"),
//      rows_in_block: 500,
//      blocks_in_cluster: 10
//    });
//        console.timeEnd("clusterize")

        document.querySelector("#sync").classList.remove("disabled")
        document.querySelector("#sync").disabled = false
        document.querySelector("#sync i").classList.remove("fa-spin")


        this.selection.init()
      }, 0)
    }
  }
  async synchronize (paths, cb) {
    document.querySelector("#sync").classList.add("disabled")
    document.querySelector("#sync").disabled = true
    document.querySelector("#sync i").classList.add("fa-spin")
    if (paths) {
      document.querySelector(".status").innerHTML = "synchronizing..."
      this.sync_counter = 0
      this.sync_complete = false
      await new Promise((resolve, reject) => {
        window.electronAPI.sync({ paths })
        let interval = setInterval(() => {
          if (this.sync_complete) {
            clearInterval(interval)
            resolve()
          }
        }, 1000)
      })
      if (cb) {
        await cb()
      }
    } else {
      let folderpaths = await this.db.folders.toArray()
      console.log("folderpaths", folderpaths)
      for(let folderpath of folderpaths) {
        let root_path = folderpath.name
        let c = await this.checkpoint(root_path)
        console.log("c", c)
        document.querySelector(".status").innerHTML = "synchronizing from " + root_path
        this.sync_counter = 0
        this.sync_complete = false
        await new Promise((resolve, reject) => {
          const config = {
            root_path,
            checkpoint: c,
          }
          if (this.sync_mode === "true") {
            // nothing
          } else if (this.sync_mode === "reindex") {
            config.force = true
          }
          console.log("config", config)
          window.electronAPI.sync(config)
          let interval = setInterval(() => {
            if (this.sync_complete) {
              clearInterval(interval)
              resolve()
            }
          }, 1000)
        })
      }
      this.sync_counter = 0
      document.querySelector(".status").innerHTML = ""
      this.bar.go(100)
      let query = document.querySelector(".search").value
      if (query && query.length > 0) {
        await this.search(query)
      } else {
        await this.search()
      }
    }
  //  await render()
  }
  async fill (items) {
  console.time("fill")

    const chunkSize = 800;
  //  document.querySelector(".content").innerHTML = ""
    document.querySelector(".container").classList.remove("hidden")
    document.querySelector(".status").innerHTML = "Loading..."
  //  document.querySelector(".content").innerHTML = items.map((item) => {
  //    return `<div class='card' data-root="${item.root_path}" data-src="${item.file_path}">${card(item)}</div>`
  //  }).join("")

    let data = items.map((item) => {
      return `<div class='card' data-root="${item.root_path}" data-src="${item.file_path}">${card(item)}</div>`
    })


    this.clusterize = new Clusterize({
      rows: data,
      scrollElem: document.querySelector(".container"),
      contentElem: document.querySelector(".content"),
      rows_in_block: 500,
      blocks_in_cluster: 10
    });



  //
  //
  //  
  //  if (ds) ds.stop(true, true)
  //  ds = null
  //  ds = new DragSelect({
  //    selectables: document.querySelectorAll('.card'),
  //    area: document.querySelector(".content"),
  //    draggability: false,
  //  });
  //  ds.subscribe('callback', async (e) => {
  //    if (e.items && e.items.length > 0) {
  //      // reset tags
  //      updateSelection(e.items)
  //    } else {
  //      selectedEls = []
  //      document.querySelector("footer").classList.add("hidden")
  //    }
  //  });



/*
    for (let i=0; i<items.length; i+=chunkSize) {
      console.log("i", i)
      const chunk = items.slice(i, i + chunkSize);
//      clusterize.append(chunk.map((item) => {
//        return `<div class='card' data-root="${item.root_path}" data-src="${item.file_path}">${card(item)}</div>`
//      }))
  
  
      let frag = document.createDocumentFragment();
      for(let item of chunk) {
        let el = document.createElement("div")
        el.className = "card"
        el.setAttribute("data-root", item.root_path)
        el.setAttribute("data-src", item.file_path)
        el.innerHTML = card(item)
        frag.appendChild(el)
      }
      document.querySelector(".content").appendChild(frag)
//      this.bar.go(100 * i/items.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    */


  //  let els = []
  //  for (let i=0; i<items.length; i++) {
  //    let item = items[i]
  //    let el = document.createElement("div")
  //    el.className = "card"
  //    el.setAttribute("data-root", item.root_path)
  //    el.setAttribute("data-src", item.file_path)
  //    el.innerHTML = card(item)
  //    els.push(el)
  //    bar.go(100 * i/items.length);
  //  }
  //  document.querySelector(".content").replaceChildren(...els)



  //  console.time("ds.start")
  //  ds.setSettings({
  //    selectables: document.querySelectorAll('.card'),
  //  })
  //  ds.start()
  //  console.timeEnd("ds.start")
//    this.bar.go(100)
    document.querySelector(".status").innerHTML = ""
  console.timeEnd("fill")
    document.querySelector(".loading").classList.add("hidden")

  }
  async draw () {
  //  if (!silent) {
  //    history.pushState({ query }, "")
  //  }
    document.querySelector(".loading").classList.remove("hidden")
    document.querySelector(".search").value = (this.query && this.query.length ? this.query : "")
    document.querySelector("footer").classList.add("hidden")
    document.querySelector(".container").classList.add("hidden")
    if (this.query) {
      let favorited = await this.db.favorites.get(this.query)
      if (favorited) {
        document.querySelector("nav #favorite").classList.add("selected") 
        document.querySelector("nav #favorite i").className = "fa-solid fa-star"
      } else {
        document.querySelector("nav #favorite").classList.remove("selected") 
        document.querySelector("nav #favorite i").className = "fa-regular fa-star"
      }
    } else {
      document.querySelector("nav #favorite").classList.remove("selected") 
      document.querySelector("nav #favorite i").className = "fa-regular fa-star"
    }
    this.worker.postMessage({ query: this.query, sorter: this.navbar.sorter })
  }
  async search (query, silent) {
    console.log("this.sorter_code", this.sorter_code)
    debugger
    let params = (this.sorter_code ? new URLSearchParams({ sorter_code: this.sorter_code }) : new URLSearchParams())
    if (query && query.length > 0) {
      params.set("query", query)
    }
    location.href = "/?" + params.toString()
  }
  stripPunctuation (str) {
    return str.replace(/(^[^\p{L}\s]|[^\p{L}\s]$)/gu,"")
  }

}
const app = new App(QUERY, SYNC, SORTER);
(async () => {
  await app.init()
})();
