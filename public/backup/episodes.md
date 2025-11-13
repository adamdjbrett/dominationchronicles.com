---
layout: base.njk 
title: Daftar Lengkap Episode Podcast 
pagination:
  data: collections.episodes
  size: 6
  reverse: true
testdata:
  - item1
  - item2
  - item3
  - item4
permalink: /episodes/{% if pagination.pageNumber > 0 %}{{ pagination.pageNumber + 1
  }}/{% endif %}index.html
---

---

<div class="container py-5 mt-5">
<header class="text-center mb-5">
<h1 class="display-4">{{ title }}</h1>
<p class="lead text-secondary">Jelajahi semua episode terbaru, dari yang paling baru hingga arsip.</p>
</header>

<section id="episode-list" class="row g-4">

      {% for e in collections.episodes  %}<div class="col-lg-4 col-md-6 p-1">
                    <div class="card bg-dark-secondary h-100 border-0 shadow-sm">
                        {% if e.data.image %}<img src="{{e.data.image}}" data-src="{{e.data.image}}" 
                        class="card-img-top lazy-load-image"
                        width="100%" height="100%" alt="{{e.data.title}}" loading="lazy"/>{% endif %}
                        <div class="card-body d-flex flex-column">
                            <h3 class="card-title text-white">{{e.data.title}}</h3>
                            <p class="card-text text-secondary small">Duration: {{e.data.duration}}</p>
                            <a href="{{e.url}}" class="btn btn-outline-primary mt-auto stretched-link">
                                {{widget.episode.button_episodes}}<i class="fas fa-circle-play ms-2"></i>
                            </a>
                        </div>
                    </div>
                </div>{% endfor %}
    {% if podcast.length > 0 %}
        {% for episode in podcast %}
            <div class="col-md-6 col-lg-4 d-flex">
                <div class="card bg-dark-secondary h-100 w-100 border-0 shadow-lg transition-transform hover:scale-105">
                    <a href="/episodes/{{ episode.title | slugify | lower }}/" class="text-decoration-none text-white">
                        <img class="card-img-top lazy-load-image"
                             src="https://placehold.co/400x400/2c2c2e/f5f5f7?text=Loading"
                             data-src="{{ episode.image }}" 
                             alt="Cover Episode: {{ episode.title }}"
                             loading="lazy"
                        >
                        <div class="card-body">
                            <small class="text-info">{{ episode.pubDate }}</small> 
                            <h2 class="h5 mt-2 mb-2">{{ episode.title }}</h2>
                            <p class="card-text small text-secondary">
                                {{ episode.description | striptags | truncate(150) }}
                            </p>
                        </div>
                    </a>
                </div>
            </div>
        {% endfor %}
    {% else %}
        <div class="col-12 text-center">
            <p class="text-secondary">Saat ini belum ada episode podcast yang tersedia.</p>
        </div>
    {% endif %}
</section>


</div>