// Download links come from the newest GitHub release, so the page never
// needs editing when a version ships. Without the API (offline, rate limit)
// every link falls back to the releases page.
(function () {
  'use strict';

  var REPO = 'perdeyvariant-hue/FirLauncher';
  var RELEASES = 'https://github.com/' + REPO + '/releases/latest';

  // Which files belong where, in the order they are offered; the first one
  // of a system is its main download.
  var FILES = {
    windows: [
      { test: /_x64-setup\.exe$/, label: 'Установщик (.exe)' },
      { test: /_x64_en-US\.msi$/, label: 'Пакет MSI' },
    ],
    macos: [
      { test: /_aarch64\.dmg$/, label: 'Apple Silicon (.dmg)' },
      { test: /_x64\.dmg$/, label: 'Intel (.dmg)' },
    ],
    linux: [
      { test: /_amd64\.AppImage$/, label: 'AppImage' },
      { test: /_amd64\.deb$/, label: 'Debian, Ubuntu (.deb)' },
      { test: /\.x86_64\.rpm$/, label: 'Fedora, openSUSE (.rpm)' },
    ],
  };

  var NAMES = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

  function detectOs() {
    var platform = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
    var agent = navigator.userAgent.toLowerCase();
    if (platform.indexOf('win') !== -1 || agent.indexOf('windows') !== -1) return 'windows';
    if (platform.indexOf('mac') !== -1 || agent.indexOf('mac os') !== -1) return 'macos';
    if (/android|iphone|ipad/.test(agent)) return null;
    if (platform.indexOf('linux') !== -1 || agent.indexOf('linux') !== -1) return 'linux';
    return null;
  }

  function size(bytes) {
    return (bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ';
  }

  function date(iso) {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function link(href, text, bytes) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    if (bytes) {
      var s = document.createElement('span');
      s.className = 'size';
      s.textContent = size(bytes);
      a.appendChild(s);
    }
    var li = document.createElement('li');
    li.appendChild(a);
    return li;
  }

  function fallback(list) {
    var li = document.createElement('li');
    li.className = 'fallback';
    li.innerHTML = 'Файлы — на <a href="' + RELEASES + '">странице релиза</a>.';
    list.appendChild(li);
  }

  var os = detectOs();
  var platforms = document.querySelectorAll('.platform');

  // Mark the visitor's system before anything loads.
  platforms.forEach(function (box) {
    if (box.getAttribute('data-os') === os) {
      box.classList.add('is-yours');
      var mark = document.createElement('span');
      mark.className = 'yours';
      mark.textContent = 'Ваша система';
      box.querySelector('h3').appendChild(mark);
    }
  });

  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  })
    .then(function (response) {
      if (!response.ok) throw new Error('GitHub ' + response.status);
      return response.json();
    })
    .then(function (release) {
      var version = release.tag_name.replace(/^v/, '');
      var line = document.getElementById('release-line');
      line.innerHTML = '';
      // "1 октября 2026 г." already ends with a full stop.
      var when = date(release.published_at);
      line.append('Версия ' + version + ' от ' + when + (/\.$/.test(when) ? ' ' : '. '));
      var notes = document.createElement('a');
      notes.href = release.html_url;
      notes.textContent = 'Что нового';
      line.appendChild(notes);

      var main = {};
      platforms.forEach(function (box) {
        var key = box.getAttribute('data-os');
        var list = box.querySelector('.files');
        FILES[key].forEach(function (file) {
          var asset = release.assets.find(function (item) {
            return file.test.test(item.name);
          });
          if (!asset) return;
          if (!main[key]) main[key] = asset;
          list.appendChild(link(asset.browser_download_url, file.label, asset.size));
        });
        if (!list.children.length) fallback(list);
      });

      var hero = document.getElementById('hero-download');
      var meta = document.getElementById('hero-meta');
      if (os && main[os]) {
        hero.href = main[os].browser_download_url;
        hero.textContent = 'Скачать для ' + NAMES[os];
        meta.textContent =
          'Версия ' + version + ', ' + size(main[os].size) + '. Есть версии для Windows, macOS и Linux.';
      } else {
        meta.textContent = 'Версия ' + version + ' для Windows, macOS и Linux.';
      }
    })
    .catch(function () {
      platforms.forEach(function (box) {
        fallback(box.querySelector('.files'));
      });
    });
})();
