(function () {
  var page = document.getElementById('page')
  if (!page) return
  var parser = window.marked

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  if (parser) {
    parser.use({
      renderer: {
        html: function (token) {
          return escapeHtml(typeof token === 'string' ? token : (token && (token.raw || token.text)) || '')
        },
      },
    })
  }

  function clean(root) {
    root.querySelectorAll('img').forEach(function (image) {
      image.replaceWith(document.createTextNode(image.getAttribute('alt') || ''))
    })
    root.querySelectorAll('a[href]').forEach(function (link) {
      if (!/^(https?:|#)/i.test(link.getAttribute('href') || '')) link.removeAttribute('href')
    })
  }

  function colourSeats(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    var nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(function (node) {
      var parent = node.parentElement
      if (parent && parent.closest('code, pre, a, .ref')) return
      var pattern = /\b([Ss]eats?) (\d+)\b((?:(?:, and |, or |, | and | or )\d+\b)*)/g
      var text = node.nodeValue || ''
      var hit = pattern.exec(text)
      if (!hit) return
      var out = document.createDocumentFragment()
      var from = 0
      var mark = function (label, seat) {
        var span = document.createElement('span')
        span.className = 'ref s' + (((Number(seat) - 1) % 6) + 1)
        span.textContent = label
        out.appendChild(span)
      }
      while (hit) {
        out.appendChild(document.createTextNode(text.slice(from, hit.index)))
        mark(hit[1] + ' ' + hit[2], hit[2])
        hit[3].split(/(\d+)/).forEach(function (piece) {
          if (/^\d+$/.test(piece)) mark(piece, piece)
          else if (piece) out.appendChild(document.createTextNode(piece))
        })
        from = hit.index + hit[0].length
        hit = pattern.exec(text)
      }
      out.appendChild(document.createTextNode(text.slice(from)))
      node.replaceWith(out)
    })
  }

  document.querySelectorAll('[data-md]').forEach(function (element) {
    if (!parser) return colourSeats(element)
    var holder = document.createElement('template')
    var source = element.textContent || ''
    holder.innerHTML = element.getAttribute('data-md') === 'inline' ? parser.parseInline(source) : parser.parse(source)
    clean(holder.content)
    colourSeats(holder.content)
    element.textContent = ''
    element.appendChild(holder.content)
    element.classList.remove('raw')
  })

  document.querySelectorAll('[data-ts]').forEach(function (element) {
    var when = new Date(Number(element.getAttribute('data-ts')))
    if (isNaN(when.getTime())) return
    element.textContent = when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  })

  function bindToggle(name, allowed) {
    var buttons = document.querySelectorAll('[data-set-' + name + ']')
    if (buttons.length === 0) return
    var choose = function (value) {
      page.setAttribute('data-' + name, value)
      buttons.forEach(function (button) {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-set-' + name) === value))
      })
      try {
        localStorage.setItem('panel-' + name, value)
      } catch (error) {}
    }
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        choose(button.getAttribute('data-set-' + name))
      })
    })
    try {
      var saved = localStorage.getItem('panel-' + name)
      if (allowed.indexOf(saved) !== -1) choose(saved)
    } catch (error) {}
  }
  bindToggle('view', ['thread', 'columns'])
  bindToggle('density', ['full', 'brief'])

  document.querySelectorAll('[data-more]').forEach(function (button) {
    button.addEventListener('click', function () {
      var message = button.closest('.msg')
      if (message) message.classList.add('open')
    })
  })

  var question = document.getElementById('question')
  if (question && question.scrollHeight > question.clientHeight + 2) {
    var showAll = document.createElement('button')
    showAll.type = 'button'
    showAll.className = 'show-all'
    showAll.textContent = 'Show all of it'
    showAll.addEventListener('click', function () {
      question.classList.remove('clamped')
      showAll.remove()
    })
    question.after(showAll)
  } else if (question) question.classList.remove('clamped')

  var stops = Array.prototype.map.call(document.querySelectorAll('#outline a'), function (link) {
    return { link: link, target: document.getElementById(link.getAttribute('href').slice(1)) }
  }).filter(function (stop) { return stop.target })
  if (stops.length > 0) {
    var isQueued = false
    var mark = function () {
      isQueued = false
      var here = stops[0]
      stops.forEach(function (stop) {
        if (stop.target.getBoundingClientRect().top <= 120) here = stop
      })
      stops.forEach(function (stop) {
        stop.link.classList.toggle('here', stop === here)
      })
    }
    window.addEventListener('scroll', function () {
      if (isQueued) return
      isQueued = true
      requestAnimationFrame(mark)
    }, { passive: true })
    mark()
  }

  var foldKey = 'panel-folds-' + page.getAttribute('data-run')
  try {
    var unfolded = JSON.parse(sessionStorage.getItem(foldKey) || '[]')
    sessionStorage.removeItem(foldKey)
    unfolded.forEach(function (id) {
      var fold = document.getElementById(id)
      if (fold && fold.tagName === 'DETAILS') fold.open = true
    })
  } catch (error) {}

  var scrollKey = 'panel-scroll-' + page.getAttribute('data-run')
  try {
    var kept = sessionStorage.getItem(scrollKey)
    if (kept !== null) {
      sessionStorage.removeItem(scrollKey)
      document.documentElement.style.scrollBehavior = 'auto'
      window.scrollTo(0, Number(kept))
      document.documentElement.style.scrollBehavior = ''
    }
  } catch (error) {}

  document.querySelectorAll('#history, #outline').forEach(function (rail) {
    var fade
    rail.addEventListener('scroll', function () {
      rail.classList.add('scrolling')
      clearTimeout(fade)
      fade = setTimeout(function () {
        rail.classList.remove('scrolling')
      }, 900)
    }, { passive: true })
  })

  var historyList = document.getElementById('history-list')
  if (historyList) {
    var aside = document.getElementById('history')
    var runId = page.getAttribute('data-run')
    var where = document.getElementById('history-where')
    try {
      if (where) where.textContent = decodeURIComponent(location.pathname.split('/').slice(-3, -2)[0] || '')
    } catch (error) {}
    var isFirstDraw = true
    var span = function (className, text) {
      var element = document.createElement('span')
      element.className = className
      element.textContent = text
      return element
    }
    var dayOf = function (when) {
      if (isNaN(when.getTime())) return 'Undated'
      var days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(when).setHours(0, 0, 0, 0)) / 86400000)
      return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
    }
    window.__panelHistory = function (runs) {
      if (!Array.isArray(runs)) return
      var drawn = document.createDocumentFragment()
      var day = ''
      var current = null
      runs.forEach(function (run) {
        var when = new Date(Number(run.startedAt))
        if (dayOf(when) !== day) {
          day = dayOf(when)
          var heading = document.createElement('li')
          heading.className = 'history-day'
          heading.textContent = day
          drawn.appendChild(heading)
        }
        var item = document.createElement('li')
        var link = document.createElement('a')
        var meta = span('history-meta', '')
        item.className = 'history-item' + (run.id === runId ? ' current' : '')
        link.href = '../' + encodeURIComponent(run.folder) + '/discussion.html'
        if (run.id === runId) link.setAttribute('aria-current', 'page')
        meta.appendChild(span('', (run.kind === 'pingpong' ? 'Ping-pong' : 'Panel') + (isNaN(when.getTime()) ? '' : ', ' + when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))))
        if (run.state !== 'done') meta.appendChild(span('history-flag ' + run.state, ' · ' + run.state))
        link.appendChild(meta)
        link.appendChild(span('history-q', String(run.question || '')))
        if (run.headline) link.appendChild(span('history-head', String(run.headline)))
        item.appendChild(link)
        drawn.appendChild(item)
        if (run.id === runId) current = item
      })
      historyList.textContent = ''
      historyList.appendChild(drawn)
      if (isFirstDraw && current && getComputedStyle(aside).position === 'fixed') aside.scrollTop = current.offsetTop - aside.clientHeight / 2
      isFirstDraw = false
    }
    var historyOpened = Date.now()
    var loadHistory = function () {
      var probe = document.createElement('script')
      probe.src = '../history.js?' + Date.now()
      probe.onload = probe.onerror = function () {
        probe.remove()
      }
      document.head.appendChild(probe)
    }
    loadHistory()
    var historyTimer = setInterval(function () {
      if (Date.now() - historyOpened > 3 * 60 * 60 * 1000) return clearInterval(historyTimer)
      loadHistory()
    }, 15000)
  }

  if (page.getAttribute('data-poll') !== 'yes') return
  var shown = Number(page.getAttribute('data-rev'))
  var opened = Date.now()
  window.__panelRev = function (latest) {
    if (latest === shown) return
    try {
      sessionStorage.setItem(scrollKey, String(window.scrollY))
      sessionStorage.setItem(foldKey, JSON.stringify(Array.prototype.map.call(document.querySelectorAll('details[id][open]'), function (fold) { return fold.id })))
    } catch (error) {}
    location.reload()
  }
  var timer = setInterval(function () {
    if (Date.now() - opened > 3 * 60 * 60 * 1000) return clearInterval(timer)
    var probe = document.createElement('script')
    probe.src = 'discussion.rev.js?' + Date.now()
    probe.onload = probe.onerror = function () {
      probe.remove()
    }
    document.head.appendChild(probe)
  }, 2000)
})()
