'use strict';

// Pobieranie elementów
const form = document.querySelector('.form');
const containerWorkouts = document.querySelector('.workouts');
const inputType = document.querySelector('.form__input--type');
const inputDescription = document.querySelector('.form__input--description');
const fullscreenBtn = document.querySelector('.fullscreen-btn');
const addCurrentLocationBtn = document.querySelector(
  '.add-current-location-btn'
);
const body = document.querySelector('body');

// Inicjalizacja bazy danych Dexie
const db = new Dexie('WorkoutsDatabase');
db.version(1).stores({
  workouts: 'id, date, coords, type, description',
});

class Workout {
  date = new Date();
  id = (Date.now() + '').slice(-10);

  constructor(coords, type, description) {
    this.coords = coords; // [lat, lng]
    this.type = type; // 'roslina', 'grzyb', 'atrakcja', 'szkolka'
    this.description = description;
    this.setDescription();
  }

  setDescription() {
    this.title = `${this.type[0].toUpperCase()}${this.type.slice(1)}: ${
      this.description
    }`;
  }
}

class App {
  #map;
  #mapEvent;
  #workouts = [];
  #zoom = 13;
  #markers = [];
  #routingControl;
  #currentRouteDestinationCoords;

  constructor() {
    // Pobranie pozycji użytkownika
    this._getPosition();

    // Pobranie danych z IndexedDB
    this._loadWorkoutsFromDB();

    // Obsługa zdarzeń
    form.addEventListener('submit', this._newWorkout.bind(this));
    containerWorkouts.addEventListener('click', this._moveToPopup.bind(this));

    // Przycisk pełnoekranowy
    fullscreenBtn.addEventListener('click', this._toggleFullscreen.bind(this));

    // Przycisk dodawania znacznika w aktualnej lokalizacji
    addCurrentLocationBtn.addEventListener(
      'click',
      this._addMarkerAtCurrentLocation.bind(this)
    );
  }

  _getPosition() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        this._loadMap.bind(this),
        error => {
          console.error(error.message);
          alert('Nie można uzyskać Twojej lokalizacji.');
        }
      );
    } else {
      alert('Twoja przeglądarka nie obsługuje geolokalizacji.');
    }
  }

  _loadMap(position) {
    const { latitude } = position.coords;
    const { longitude } = position.coords;

    const coords = [latitude, longitude];

    this.#map = L.map('map').setView(coords, this.#zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.#map);

    // Obsługa kliknięć na mapie
    this.#map.on('click', this._showForm.bind(this));

    // Wyświetlenie zapisanych markerów
    this.#workouts.forEach(workout => {
      this._renderWorkoutMarker(workout);
    });
  }

  _showForm(mapE) {
    if (mapE) {
      this.#mapEvent = mapE;
    }
    form.classList.remove('hidden');
    inputDescription.focus();
  }

  _hideForm() {
    // Wyczyszczenie pól formularza
    inputDescription.value = '';
    form.classList.add('hidden');
  }

  _newWorkout(e) {
    e.preventDefault();

    // Pobranie danych z formularza
    const type = inputType.value;
    const description = inputDescription.value;
    const { lat, lng } = this.#mapEvent.latlng;

    if (!description) return alert('Proszę wpisać opis.');

    const workout = new Workout([lat, lng], type, description);

    // Dodanie nowego obiektu do tablicy
    this.#workouts.push(workout);

    // Zapisanie w IndexedDB
    this._saveWorkoutToDB(workout);

    // Wyświetlenie markera
    this._renderWorkoutMarker(workout);

    // Wyświetlenie wpisu na liście
    this._renderWorkout(workout);

    // Ukrycie formularza i wyczyszczenie pól
    this._hideForm();
  }

  _renderWorkoutMarker(workout) {
    const colorMap = {
      roslina: 'green',
      grzyb: 'orange',
      atrakcja: 'blue',
      szkolka: 'red',
    };

    const markerHtmlStyles = `
      background-color: ${colorMap[workout.type]};
      width: 2rem;
      height: 2rem;
      display: block;
      left: -1rem;
      top: -1rem;
      position: relative;
      border-radius: 3rem 3rem 0;
      transform: rotate(45deg);
      border: 1px solid #FFFFFF`;

    const icon = L.divIcon({
      className: 'my-custom-pin',
      iconAnchor: [0, 24],
      labelAnchor: [-6, 0],
      popupAnchor: [0, -36],
      html: `<span style="${markerHtmlStyles}" />`,
    });

    const marker = L.marker(workout.coords, { icon: icon })
      .addTo(this.#map)
      .bindPopup(
        L.popup({
          maxWidth: 250,
          minWidth: 100,
          autoClose: false,
          closeOnClick: false,
          className: `${workout.type}-popup`,
        })
      )
      .setPopupContent(`${workout.title}`)
      .openPopup();

    // Przechowywanie referencji do markera
    this.#markers.push({ id: workout.id, marker });
  }

  _renderWorkout(workout) {
    const html = `
      <li class="workout workout--${workout.type}" data-id="${workout.id}">
        <h2 class="workout__title">${workout.title}</h2>
        <button class="workout__delete">✖</button>
      </li>
    `;

    form.insertAdjacentHTML('afterend', html);
  }

  _moveToPopup(e) {
    const workoutEl = e.target.closest('.workout');

    if (!workoutEl) return;

    // Usuwanie wpisu
    if (e.target.classList.contains('workout__delete')) {
      this._deleteWorkout(workoutEl);
      return;
    }

    const workout = this.#workouts.find(
      work => work.id === workoutEl.dataset.id
    );

    // Sprawdź, czy geolokalizacja jest dostępna
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude } = position.coords;
          const currentCoords = [latitude, longitude];

          // Ustawienie widoku mapy
          this.#map.setView(workout.coords, this.#zoom, {
            animate: true,
            pan: {
              duration: 1,
            },
          });

          // Jeśli istnieje poprzednia trasa, usuń ją
          if (this.#routingControl) {
            this.#map.removeControl(this.#routingControl);
          }

          // Przechowaj współrzędne celu trasy
          this.#currentRouteDestinationCoords = workout.coords;

          // Utwórz nową trasę
          this.#routingControl = L.Routing.control({
            waypoints: [L.latLng(currentCoords), L.latLng(workout.coords)],
            lineOptions: {
              styles: [{ color: 'blue', opacity: 0.6, weight: 4 }],
            },
            show: false,
            addWaypoints: false,
            routeWhileDragging: false,
            draggableWaypoints: false,
            fitSelectedRoutes: true,
            createMarker: () => null,
          }).addTo(this.#map);
        },
        () => {
          alert('Nie można pobrać Twojej aktualnej lokalizacji.');
        }
      );
    } else {
      alert('Twoja przeglądarka nie obsługuje geolokalizacji.');
    }
  }

  _deleteWorkout(workoutEl) {
    const workoutId = workoutEl.dataset.id;

    // Znajdź usuwany workout
    const workoutToDelete = this.#workouts.find(work => work.id === workoutId);

    // Usunięcie wpisu z tablicy
    this.#workouts = this.#workouts.filter(work => work.id !== workoutId);

    // Usunięcie wpisu z IndexedDB
    db.workouts.delete(workoutId);

    // Usunięcie markera z mapy
    const markerObj = this.#markers.find(marker => marker.id === workoutId);
    if (markerObj) {
      this.#map.removeLayer(markerObj.marker);
      this.#markers = this.#markers.filter(marker => marker.id !== workoutId);
    }

    // Usunięcie elementu z DOM
    workoutEl.remove();

    // Sprawdź, czy usunięty workout jest celem aktualnej trasy
    if (
      this.#routingControl &&
      this.#currentRouteDestinationCoords &&
      workoutToDelete.coords[0] === this.#currentRouteDestinationCoords[0] &&
      workoutToDelete.coords[1] === this.#currentRouteDestinationCoords[1]
    ) {
      // Usuń kontroler trasy z mapy
      this.#map.removeControl(this.#routingControl);
      this.#routingControl = null;
      this.#currentRouteDestinationCoords = null;
    }
  }

  _toggleFullscreen() {
    body.classList.toggle('map-fullscreen');
    if (body.classList.contains('map-fullscreen')) {
      fullscreenBtn.textContent = 'Wyjdź z pełnego ekranu';
    } else {
      fullscreenBtn.textContent = 'Pokaż mapę na pełnym ekranie';
    }
    // Invalidate map size after a short delay to ensure the DOM has updated
    setTimeout(() => {
      this.#map.invalidateSize();
    }, 100);
  }

  _addMarkerAtCurrentLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude } = position.coords;
          const coords = [latitude, longitude];

          // Ustawienie mapy na aktualną pozycję
          this.#map.setView(coords, this.#zoom, {
            animate: true,
            pan: {
              duration: 1,
            },
          });

          // Symulacja zdarzenia mapy
          this.#mapEvent = {
            latlng: {
              lat: latitude,
              lng: longitude,
            },
          };

          // Wyświetlenie formularza
          this._showForm();
        },
        () => {
          alert('Nie można pobrać Twojej aktualnej lokalizacji.');
        }
      );
    } else {
      alert('Twoja przeglądarka nie obsługuje geolokalizacji.');
    }
  }

  _saveWorkoutToDB(workout) {
    db.workouts.put(workout).catch(e => {
      console.error('Błąd zapisu w IndexedDB', e);
    });
  }

  _loadWorkoutsFromDB() {
    db.workouts
      .toArray()
      .then(workouts => {
        this.#workouts = workouts.map(workoutData => {
          const workout = new Workout(
            workoutData.coords,
            workoutData.type,
            workoutData.description
          );
          workout.id = workoutData.id;
          workout.date = new Date(workoutData.date);
          return workout;
        });

        this.#workouts.forEach(workout => {
          this._renderWorkout(workout);
          if (this.#map) {
            this._renderWorkoutMarker(workout);
          }
        });
      })
      .catch(e => {
        console.error('Błąd odczytu z IndexedDB', e);
      });
  }
}

const app = new App();
