// Download links come from the newest GitHub release, so the page never
// needs editing when a version ships. Without the API (offline, rate limit)
// every link falls back to the releases page. The page's own language
// (<html lang>) picks the wording.
(function () {
  'use strict';

  var REPO = 'perdeyvariant-hue/FirLauncher';
  var RELEASES = 'https://github.com/' + REPO + '/releases/latest';
  var EN = document.documentElement.lang === 'en';

  var TEXT = EN
    ? {
        locale: 'en-GB',
        mb: 'MB',
        exe: 'Installer (.exe)',
        msi: 'MSI package',
        arm: 'Apple Silicon (.dmg)',
        intel: 'Intel (.dmg)',
        deb: 'Debian, Ubuntu (.deb)',
        rpm: 'Fedora, openSUSE (.rpm)',
        yours: 'Your system',
        fallback: 'Files are on the <a href="' + RELEASES + '">release page</a>.',
        released: function (version, when) {
          return 'Version ' + version + ', released ' + when + '. ';
        },
        notes: 'What’s new',
        downloadFor: 'Download for ',
        heroMeta: function (version, size) {
          return 'Version ' + version + ', ' + size + '. Available for Windows, macOS and Linux.';
        },
        heroAll: function (version) {
          return 'Version ' + version + ' for Windows, macOS and Linux.';
        },
      }
    : {
        locale: 'ru-RU',
        mb: 'МБ',
        exe: 'Установщик (.exe)',
        msi: 'Пакет MSI',
        arm: 'Apple Silicon (.dmg)',
        intel: 'Intel (.dmg)',
        deb: 'Debian, Ubuntu (.deb)',
        rpm: 'Fedora, openSUSE (.rpm)',
        yours: 'Ваша система',
        fallback: 'Файлы — на <a href="' + RELEASES + '">странице релиза</a>.',
        released: function (version, when) {
          // "1 октября 2026 г." already ends with a full stop.
          return 'Версия ' + version + ' от ' + when + (/\.$/.test(when) ? ' ' : '. ');
        },
        notes: 'Что нового',
        downloadFor: 'Скачать для ',
        heroMeta: function (version, size) {
          return 'Версия ' + version + ', ' + size + '. Есть версии для Windows, macOS и Linux.';
        },
        heroAll: function (version) {
          return 'Версия ' + version + ' для Windows, macOS и Linux.';
        },
      };

  // Which files belong where, in the order they are offered; the first one
  // of a system is its main download.
  var FILES = {
    windows: [
      { test: /_x64-setup\.exe$/, label: TEXT.exe },
      { test: /_x64_en-US\.msi$/, label: TEXT.msi },
    ],
    macos: [
      { test: /_aarch64\.dmg$/, label: TEXT.arm },
      { test: /_x64\.dmg$/, label: TEXT.intel },
    ],
    linux: [
      { test: /_amd64\.AppImage$/, label: 'AppImage' },
      { test: /_amd64\.deb$/, label: TEXT.deb },
      { test: /\.x86_64\.rpm$/, label: TEXT.rpm },
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
    return (bytes / 1024 / 1024).toLocaleString(TEXT.locale, { maximumFractionDigits: 1 }) + ' ' + TEXT.mb;
  }

  function date(iso) {
    return new Date(iso).toLocaleDateString(TEXT.locale, { day: 'numeric', month: 'long', year: 'numeric' });
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
    li.innerHTML = TEXT.fallback;
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
      mark.textContent = TEXT.yours;
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
      line.append(TEXT.released(version, date(release.published_at)));
      var notes = document.createElement('a');
      notes.href = release.html_url;
      notes.textContent = TEXT.notes;
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
        hero.textContent = TEXT.downloadFor + NAMES[os];
        meta.textContent = TEXT.heroMeta(version, size(main[os].size));
      } else {
        meta.textContent = TEXT.heroAll(version);
      }
    })
    .catch(function () {
      platforms.forEach(function (box) {
        fallback(box.querySelector('.files'));
      });
    });
})();
