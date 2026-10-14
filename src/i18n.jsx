import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api'

export const APP_LANGUAGES = [
  { code: 'en', name: 'English' }, { code: 'fr', name: 'Français' }, { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' }, { code: 'it', name: 'Italiano' }, { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'nl', name: 'Nederlands' }, { code: 'pl', name: 'Polski' }, { code: 'sv', name: 'Svenska' },
]
const LOCALES = ['fr', 'de', 'es', 'it', 'pt-BR', 'nl', 'pl', 'sv']

// A missing phrase intentionally falls back to English. The music metadata
// itself (artist names, album titles, filenames) is never translated.
const ROWS = {
  'Home': ['Accueil','Startseite','Inicio','Home','Início','Startpagina','Strona główna','Hem'],
  'Library': ['Bibliothèque','Mediathek','Biblioteca','Libreria','Biblioteca','Bibliotheek','Biblioteka','Bibliotek'],
  'Recap': ['Récapitulatif','Rückblick','Resumen','Riepilogo','Retrospectiva','Terugblik','Podsumowanie','Återblick'],
  'Albums': ['Albums','Alben','Álbumes','Album','Álbuns','Albums','Albumy','Album'],
  'Artists': ['Artistes','Künstler','Artistas','Artisti','Artistas','Artiesten','Artyści','Artister'],
  'Videos': ['Vidéos','Videos','Vídeos','Video','Vídeos','Video’s','Filmy','Videor'],
  'Audio Quality': ['Qualité audio','Audioqualität','Calidad de audio','Qualità audio','Qualidade de áudio','Audiokwaliteit','Jakość dźwięku','Ljudkvalitet'],
  'Playlists': ['Playlists','Wiedergabelisten','Listas de reproducción','Playlist','Playlists','Afspeellijsten','Playlisty','Spellistor'],
  'Liked Songs': ['Titres likés','Lieblingssongs','Canciones que te gustan','Brani che ti piacciono','Músicas curtidas','Favoriete nummers','Polubione utwory','Gillade låtar'],
  'Sign In / Register': ['Connexion / Inscription','Anmelden / Registrieren','Iniciar sesión / Registrarse','Accedi / Registrati','Entrar / Cadastrar','Inloggen / Registreren','Zaloguj / Zarejestruj','Logga in / Registrera dig'],
  'Sign Out': ['Se déconnecter','Abmelden','Cerrar sesión','Esci','Sair','Uitloggen','Wyloguj','Logga ut'],
  'Sign out': ['Se déconnecter','Abmelden','Cerrar sesión','Esci','Sair','Uitloggen','Wyloguj','Logga ut'],
  'Confirm sign out': ['Confirmer la déconnexion','Abmeldung bestätigen','Confirmar cierre de sesión','Conferma uscita','Confirmar saída','Uitloggen bevestigen','Potwierdź wylogowanie','Bekräfta utloggning'],
  'Are you sure?': ['Êtes-vous sûr ?','Bist du sicher?','¿Estás seguro?','Confermi?','Tem certeza?','Weet je het zeker?','Czy na pewno?','Är du säker?'],
  'Cancel': ['Annuler','Abbrechen','Cancelar','Annulla','Cancelar','Annuleren','Anuluj','Avbryt'],
  'Add': ['Ajouter','Hinzufügen','Añadir','Aggiungi','Adicionar','Toevoegen','Dodaj','Lägg till'],
  'Remove': ['Retirer','Entfernen','Quitar','Rimuovi','Remover','Verwijderen','Usuń','Ta bort'],
  'Search': ['Rechercher','Suchen','Buscar','Cerca','Pesquisar','Zoeken','Szukaj','Sök'],
  'Settings': ['Paramètres','Einstellungen','Ajustes','Impostazioni','Configurações','Instellingen','Ustawienia','Inställningar'],
  'Integrations': ['Intégrations','Integrationen','Integraciones','Integrazioni','Integrações','Integraties','Integracje','Integrationer'],
  'Playback': ['Lecture','Wiedergabe','Reproducción','Riproduzione','Reprodução','Afspelen','Odtwarzanie','Uppspelning'],
  'Addons': ['Extensions','Add-ons','Complementos','Componenti aggiuntivi','Complementos','Add-ons','Dodatki','Tillägg'],
  'Appearance': ['Apparence','Darstellung','Apariencia','Aspetto','Aparência','Vormgeving','Wygląd','Utseende'],
  'Data': ['Données','Daten','Datos','Dati','Dados','Gegevens','Dane','Data'],
  'About': ['À propos','Über','Acerca de','Informazioni','Sobre','Over','Informacje','Om'],
  'Language': ['Langue','Sprache','Idioma','Lingua','Idioma','Taal','Język','Språk'],
  'App Language': ['Langue de l’application','App-Sprache','Idioma de la aplicación','Lingua dell’app','Idioma do aplicativo','App-taal','Język aplikacji','Appspråk'],
  'Choose the language used for Lokal’s interface. Track and album titles from your music files are not translated.': ['Choisissez la langue de l’interface de Lokal. Les titres des morceaux et des albums provenant de vos fichiers ne sont pas traduits.','Wähle die Sprache der Lokal-Oberfläche. Titel aus deinen Musikdateien werden nicht übersetzt.','Elige el idioma de la interfaz de Lokal. Los títulos de canciones y álbumes de tus archivos no se traducen.','Scegli la lingua dell’interfaccia di Lokal. I titoli dei brani e degli album nei tuoi file non vengono tradotti.','Escolha o idioma da interface do Lokal. Os títulos das músicas e dos álbuns nos arquivos não serão traduzidos.','Kies de taal van de Lokal-interface. Nummers en albumtitels uit je muziekbestanden worden niet vertaald.','Wybierz język interfejsu Lokal. Tytuły utworów i albumów z plików muzycznych nie są tłumaczone.','Välj språk för Lokals gränssnitt. Låt- och albumtitlar från dina musikfiler översätts inte.'],
  'Theme': ['Thème','Design','Tema','Tema','Tema','Thema','Motyw','Tema'],
  'Now Playing': ['En cours de lecture','Aktuelle Wiedergabe','En reproducción','In riproduzione','Tocando agora','Wordt afgespeeld','Teraz odtwarzane','Spelas nu'],
  'Player Bar': ['Barre du lecteur','Playerleiste','Barra del reproductor','Barra del lettore','Barra do player','Spelerbalk','Pasek odtwarzacza','Spelarfält'],
  'Layout': ['Disposition','Layout','Diseño','Layout','Layout','Indeling','Układ','Layout'],
  'Downloads': ['Téléchargements','Downloads','Descargas','Download','Downloads','Downloads','Pobrane','Nedladdningar'],
  'Genres': ['Genres','Genres','Géneros','Generi','Gêneros','Genres','Gatunki','Genrer'],
  'Accounts': ['Comptes','Konten','Cuentas','Account','Contas','Accounts','Konta','Konton'],
  'Metadata': ['Métadonnées','Metadaten','Metadatos','Metadati','Metadados','Metadata','Metadane','Metadata'],
  'Backup': ['Sauvegarde','Sicherung','Copia de seguridad','Backup','Backup','Back-up','Kopia zapasowa','Säkerhetskopia'],
  'History': ['Historique','Verlauf','Historial','Cronologia','Histórico','Geschiedenis','Historia','Historik'],
  'Version': ['Version','Version','Versión','Versione','Versão','Versie','Wersja','Version'],
  'Accent Color': ['Couleur d’accentuation','Akzentfarbe','Color de acento','Colore accento','Cor de destaque','Accentkleur','Kolor akcentu','Accentfärg'],
  'On': ['Activé','Ein','Activado','Attivo','Ativado','Aan','Wł.','På'],
  'Off': ['Désactivé','Aus','Desactivado','Disattivato','Desativado','Uit','Wył.','Av'],
  'Saved': ['Enregistré','Gespeichert','Guardado','Salvato','Salvo','Opgeslagen','Zapisano','Sparat'],
  'Saving...': ['Enregistrement…','Speichern…','Guardando…','Salvataggio…','Salvando…','Opslaan…','Zapisywanie…','Sparar…'],
  'Changes save automatically': ['Les modifications sont enregistrées automatiquement','Änderungen werden automatisch gespeichert','Los cambios se guardan automáticamente','Le modifiche vengono salvate automaticamente','As alterações são salvas automaticamente','Wijzigingen worden automatisch opgeslagen','Zmiany zapisują się automatycznie','Ändringar sparas automatiskt'],
  'Retry': ['Réessayer','Erneut versuchen','Reintentar','Riprova','Tentar novamente','Opnieuw proberen','Ponów próbę','Försök igen'],
  'Play All': ['Tout lire','Alles abspielen','Reproducir todo','Riproduci tutto','Reproduzir tudo','Alles afspelen','Odtwórz wszystko','Spela upp alla'],
  'Play': ['Lire','Abspielen','Reproducir','Riproduci','Reproduzir','Afspelen','Odtwórz','Spela'],
  'Pause': ['Pause','Pause','Pausar','Pausa','Pausar','Pauzeren','Wstrzymaj','Pausa'],
  'Next': ['Suivant','Weiter','Siguiente','Successivo','Próxima','Volgende','Następny','Nästa'],
  'Previous': ['Précédent','Zurück','Anterior','Precedente','Anterior','Vorige','Poprzedni','Föregående'],
  'Shuffle': ['Aléatoire','Zufallswiedergabe','Aleatorio','Casuale','Aleatório','Willekeurig','Losowo','Blanda'],
  'Repeat': ['Répéter','Wiederholen','Repetir','Ripeti','Repetir','Herhalen','Powtórz','Upprepa'],
  'Queue': ['File d’attente','Warteschlange','Cola','Coda','Fila','Wachtrij','Kolejka','Kö'],
  'Lyrics': ['Paroles','Songtexte','Letras','Testi','Letras','Songteksten','Tekst utworu','Låttext'],
  'Play next': ['Lire ensuite','Als Nächstes abspielen','Reproducir a continuación','Riproduci dopo','Tocar a seguir','Hierna afspelen','Odtwórz jako następne','Spela härnäst'],
  'Add to queue': ['Ajouter à la file','Zur Warteschlange hinzufügen','Añadir a la cola','Aggiungi alla coda','Adicionar à fila','Aan wachtrij toevoegen','Dodaj do kolejki','Lägg till i kön'],
  'Clear Queue': ['Vider la file','Warteschlange leeren','Vaciar cola','Svuota coda','Limpar fila','Wachtrij wissen','Wyczyść kolejkę','Rensa kön'],
  'Advanced': ['Avancée','Erweitert','Avanzada','Avanzata','Avançada','Geavanceerd','Zaawansowany','Avancerad'],
  'Simple': ['Simple','Einfach','Simple','Semplice','Simples','Eenvoudig','Prosty','Enkel'],
  'Source': ['Source','Quelle','Fuente','Fonte','Origem','Bron','Źródło','Källa'],
  'All sources': ['Toutes les sources','Alle Quellen','Todas las fuentes','Tutte le fonti','Todas as origens','Alle bronnen','Wszystkie źródła','Alla källor'],
  'Music folder': ['Dossier de musique','Musikordner','Carpeta de música','Cartella musicale','Pasta de músicas','Muziekmap','Folder muzyczny','Musikmapp'],
  'Other sites': ['Autres sites','Andere Websites','Otros sitios','Altri siti','Outros sites','Andere sites','Inne strony','Andra webbplatser'],
  'All genres': ['Tous les genres','Alle Genres','Todos los géneros','Tutti i generi','Todos os gêneros','Alle genres','Wszystkie gatunki','Alla genrer'],
  'All qualities': ['Toutes les qualités','Alle Qualitäten','Todas las calidades','Tutte le qualità','Todas as qualidades','Alle kwaliteiten','Wszystkie jakości','Alla kvaliteter'],
  'Quality': ['Qualité','Qualität','Calidad','Qualità','Qualidade','Kwaliteit','Jakość','Kvalitet'],
  'Sort': ['Trier','Sortieren','Ordenar','Ordina','Ordenar','Sorteren','Sortuj','Sortera'],
  'Recently Added': ['Ajouts récents','Kürzlich hinzugefügt','Añadido recientemente','Aggiunti di recente','Adicionados recentemente','Recent toegevoegd','Ostatnio dodane','Nyligen tillagda'],
  'Title A-Z': ['Titre A-Z','Titel A–Z','Título A-Z','Titolo A-Z','Título A-Z','Titel A-Z','Tytuł A-Z','Titel A–Ö'],
  'Artist A-Z': ['Artiste A-Z','Interpret A–Z','Artista A-Z','Artista A-Z','Artista A-Z','Artiest A-Z','Artysta A-Z','Artist A–Ö'],
  'Most Played': ['Les plus écoutés','Am häufigsten gespielt','Más reproducidos','Più ascoltati','Mais reproduzidos','Meest afgespeeld','Najczęściej odtwarzane','Mest spelade'],
  'Longest': ['Les plus longs','Längste','Más largos','Più lunghi','Mais longos','Langste','Najdłuższe','Längst'],
  'Songs with errors': ['Titres en erreur','Songs mit Fehlern','Canciones con errores','Brani con errori','Músicas com erros','Nummers met fouten','Utwory z błędami','Låtar med fel'],
  'loaded tracks': ['titres chargés','geladene Titel','canciones cargadas','brani caricati','músicas carregadas','geladen nummers','wczytane utwory','inlästa låtar'],
  'Browse your music folders': ['Parcourir vos dossiers de musique','Musikordner durchsuchen','Explora tus carpetas de música','Sfoglia le cartelle musicali','Navegue pelas pastas de música','Blader door je muziekmappen','Przeglądaj foldery muzyczne','Bläddra bland musikmappar'],
  'Loading more tracks...': ['Chargement de titres supplémentaires…','Weitere Titel werden geladen…','Cargando más canciones…','Caricamento di altri brani…','Carregando mais músicas…','Meer nummers laden…','Wczytywanie kolejnych utworów…','Laddar fler låtar…'],
  'No tracks yet — pick your music folder above.': ['Aucun titre pour le moment — choisissez votre dossier de musique ci-dessus.','Noch keine Titel — wähle oben deinen Musikordner aus.','Aún no hay canciones: selecciona arriba tu carpeta de música.','Nessun brano: seleziona la cartella musicale qui sopra.','Ainda não há músicas — selecione sua pasta de músicas acima.','Nog geen nummers — kies hierboven je muziekmap.','Brak utworów — wybierz folder muzyczny powyżej.','Inga låtar ännu — välj din musikmapp ovan.'],
  'No songs with errors: everything here can be played.': ['Aucun titre en erreur : tout peut être lu.','Keine Songs mit Fehlern: Alles hier kann abgespielt werden.','No hay canciones con errores: todas se pueden reproducir.','Nessun brano con errori: tutti possono essere riprodotti.','Nenhuma música com erros: todas podem ser reproduzidas.','Geen nummers met fouten: alles kan worden afgespeeld.','Brak utworów z błędami — wszystko można odtworzyć.','Inga låtar med fel: allt här kan spelas upp.'],
  'No songs of this quality with these filters.': ['Aucun titre de cette qualité avec ces filtres.','Keine Titel dieser Qualität mit diesen Filtern.','No hay canciones de esta calidad con estos filtros.','Nessun brano di questa qualità con questi filtri.','Nenhuma música dessa qualidade com esses filtros.','Geen nummers van deze kwaliteit met deze filters.','Brak utworów tej jakości z wybranymi filtrami.','Inga låtar med den här kvaliteten och dessa filter.'],
  'No songs from this source.': ['Aucun titre provenant de cette source.','Keine Titel aus dieser Quelle.','No hay canciones de esta fuente.','Nessun brano da questa fonte.','Nenhuma música desta origem.','Geen nummers van deze bron.','Brak utworów z tego źródła.','Inga låtar från den här källan.'],
  'Show all genres': ['Afficher tous les genres','Alle Genres anzeigen','Mostrar todos los géneros','Mostra tutti i generi','Mostrar todos os gêneros','Alle genres tonen','Pokaż wszystkie gatunki','Visa alla genrer'],
  'Show all qualities': ['Afficher toutes les qualités','Alle Qualitäten anzeigen','Mostrar todas las calidades','Mostra tutte le qualità','Mostrar todas as qualidades','Alle kwaliteiten tonen','Pokaż wszystkie jakości','Visa alla kvaliteter'],
  'Music Folder': ['Dossier de musique','Musikordner','Carpeta de música','Cartella musicale','Pasta de músicas','Muziekmap','Folder muzyczny','Musikmapp'],
  'Not set': ['Non défini','Nicht festgelegt','Sin configurar','Non impostato','Não definido','Niet ingesteld','Nie ustawiono','Inte angiven'],
  'Rescan': ['Réindexer','Erneut scannen','Volver a analizar','Nuova scansione','Verificar novamente','Opnieuw scannen','Skanuj ponownie','Skanna igen'],
  'Change': ['Modifier','Ändern','Cambiar','Modifica','Alterar','Wijzigen','Zmień','Ändra'],
  'Select Folder': ['Choisir un dossier','Ordner auswählen','Seleccionar carpeta','Seleziona cartella','Selecionar pasta','Map selecteren','Wybierz folder','Välj mapp'],
  'List view': ['Vue en liste','Listenansicht','Vista de lista','Vista elenco','Visualização em lista','Lijstweergave','Widok listy','Listvy'],
  'Grid view': ['Vue en grille','Rasteransicht','Vista de cuadrícula','Vista griglia','Visualização em grade','Rasterweergave','Widok siatki','Rutnätsvy'],
  'Expand sidebar': ['Développer la barre latérale','Seitenleiste erweitern','Expandir barra lateral','Espandi barra laterale','Expandir barra lateral','Zijbalk uitklappen','Rozwiń pasek boczny','Expandera sidofältet'],
  'Collapse sidebar': ['Réduire la barre latérale','Seitenleiste einklappen','Contraer barra lateral','Comprimi barra laterale','Recolher barra lateral','Zijbalk inklappen','Zwiń pasek boczny','Fäll ihop sidofältet'],
  'New playlist': ['Nouvelle playlist','Neue Wiedergabeliste','Nueva lista de reproducción','Nuova playlist','Nova playlist','Nieuwe afspeellijst','Nowa playlista','Ny spellista'],
  'New smart playlist': ['Nouvelle playlist intelligente','Neue intelligente Playlist','Nueva lista inteligente','Nuova playlist intelligente','Nova playlist inteligente','Nieuwe slimme afspeellijst','Nowa inteligentna playlista','Ny smart spellista'],
  'Import playlist': ['Importer une playlist','Playlist importieren','Importar lista de reproducción','Importa playlist','Importar playlist','Afspeellijst importeren','Importuj playlistę','Importera spellista'],
  'Playlist name…': ['Nom de la playlist…','Name der Wiedergabeliste…','Nombre de la lista…','Nome playlist…','Nome da playlist…','Naam afspeellijst…','Nazwa playlisty…','Spellistans namn…'],
  'Albums': ['Albums','Alben','Álbumes','Album','Álbuns','Albums','Albumy','Album'],
  'Album': ['Album','Album','Álbum','Album','Álbum','Album','Album','Album'],
  'No tracks found.': ['Aucun titre trouvé.','Keine Titel gefunden.','No se encontraron canciones.','Nessun brano trovato.','Nenhuma música encontrada.','Geen nummers gevonden.','Nie znaleziono utworów.','Inga låtar hittades.'],

  'Tracks': ['Titres','Titel','Canciones','Brani','Músicas','Nummers','Utwory','Låtar'],
  'Lyrics Matches': ['Correspondances dans les paroles','Songtext-Treffer','Coincidencias en letras','Corrispondenze nei testi','Correspondências nas letras','Overeenkomsten in songteksten','Dopasowania tekstów','Träffar i låttexter'],
  'Search your library, and online, from the bar at the top.': ['Recherchez dans votre bibliothèque et en ligne depuis la barre en haut.','Suche über die Leiste oben in deiner Mediathek und online.','Busca en tu biblioteca y en internet desde la barra superior.','Cerca nella libreria e online dalla barra in alto.','Pesquise na biblioteca e na internet pela barra superior.','Zoek in je bibliotheek en online via de balk bovenaan.','Szukaj w bibliotece i w internecie za pomocą paska u góry.','Sök i biblioteket och online från fältet högst upp.'],
  'Or just start typing anywhere in Lokal. Paste a link to download it.': ['Vous pouvez aussi commencer à taper n’importe où dans Lokal. Collez un lien pour le télécharger.','Du kannst auch überall in Lokal losschreiben. Füge einen Link ein, um ihn herunterzuladen.','También puedes empezar a escribir en cualquier parte de Lokal. Pega un enlace para descargarlo.','Puoi iniziare a digitare ovunque in Lokal. Incolla un link per scaricarlo.','Você também pode começar a digitar em qualquer lugar no Lokal. Cole um link para baixar.','Je kunt ook overal in Lokal beginnen te typen. Plak een link om die te downloaden.','Możesz też zacząć pisać w dowolnym miejscu w Lokal. Wklej link, aby go pobrać.','Du kan också börja skriva var som helst i Lokal. Klistra in en länk för att ladda ner den.'],
  'Collection': ['Collection','Sammlung','Colección','Raccolta','Coleção','Collectie','Kolekcja','Samling'],
  'Listening history': ['Historique d’écoute','Hörverlauf','Historial de escucha','Cronologia ascolti','Histórico de reprodução','Luistergeschiedenis','Historia słuchania','Lyssningshistorik'],
  'Refresh artist info': ['Actualiser les informations des artistes','Künstlerinfos aktualisieren','Actualizar información de artistas','Aggiorna informazioni artista','Atualizar informações dos artistas','Artiestinformatie vernieuwen','Odśwież informacje o artystach','Uppdatera artistinformation'],
  'Which artists': ['Quels artistes','Welche Künstler','Qué artistas','Quali artisti','Quais artistas','Welke artiesten','Którzy artyści','Vilka artister'],
  'All': ['Tous','Alle','Todos','Tutti','Todos','Alle','Wszyscy','Alla'],
  'Followed': ['Suivis','Gefolgt','Seguidos','Seguiti','Seguidos','Gevolgd','Obserwowani','Följer'],
  'Only the artists you follow': ['Uniquement les artistes que vous suivez','Nur Künstler, denen du folgst','Solo los artistas que sigues','Solo gli artisti che segui','Somente os artistas que você segue','Alleen artiesten die je volgt','Tylko obserwowani artyści','Endast artister du följer'],
  'Every artist in your library': ['Tous les artistes de votre bibliothèque','Alle Künstler in deiner Mediathek','Todos los artistas de tu biblioteca','Tutti gli artisti della libreria','Todos os artistas da sua biblioteca','Alle artiesten in je bibliotheek','Wszyscy artyści w bibliotece','Alla artister i biblioteket'],
  'Name (A–Z)': ['Nom (A–Z)','Name (A–Z)','Nombre (A–Z)','Nome (A–Z)','Nome (A–Z)','Naam (A–Z)','Nazwa (A–Z)','Namn (A–Ö)'],
  'Most Tracks': ['Le plus de titres','Meiste Titel','Más canciones','Più brani','Mais músicas','Meeste nummers','Najwięcej utworów','Flest låtar'],
  'Artists view': ['Vue des artistes','Künstleransicht','Vista de artistas','Vista artisti','Visualização de artistas','Artiestweergave','Widok artystów','Artistvy'],
  'Search artists...': ['Rechercher des artistes…','Künstler suchen…','Buscar artistas…','Cerca artisti…','Pesquisar artistas…','Artiesten zoeken…','Szukaj artystów…','Sök artister…'],
  'Top Artists': ['Meilleurs artistes','Top-Künstler','Artistas principales','Artisti principali','Principais artistas','Topartiesten','Najpopularniejsi artyści','Populäraste artister'],
  'Refresh releases': ['Actualiser les sorties','Veröffentlichungen aktualisieren','Actualizar lanzamientos','Aggiorna uscite','Atualizar lançamentos','Releases vernieuwen','Odśwież wydania','Uppdatera utgåvor'],
  'Search albums, singles, EPs, or artists...': ['Rechercher des albums, singles, EP ou artistes…','Alben, Singles, EPs oder Künstler suchen…','Buscar álbumes, sencillos, EP o artistas…','Cerca album, singoli, EP o artisti…','Pesquisar álbuns, singles, EPs ou artistas…','Zoek albums, singles, ep’s of artiesten…','Szukaj albumów, singli, EP lub artystów…','Sök album, singlar, EP eller artister…'],
  'Default': ['Par défaut','Standard','Predeterminado','Predefinito','Padrão','Standaard','Domyślne','Standard'],
  'Newest': ['Plus récents','Neueste','Más recientes','Più recenti','Mais recentes','Nieuwste','Najnowsze','Nyast'],
  'Change playlist photo': ['Modifier la photo de la playlist','Playlistfoto ändern','Cambiar foto de la lista','Cambia foto playlist','Alterar foto da playlist','Playlistfoto wijzigen','Zmień zdjęcie playlisty','Ändra spellistbild'],
  'Upload playlist photo': ['Importer une photo de playlist','Playlistfoto hochladen','Subir foto de la lista','Carica foto playlist','Enviar foto da playlist','Playlistfoto uploaden','Prześlij zdjęcie playlisty','Ladda upp spellistbild'],
  'Reset playlist photo': ['Réinitialiser la photo de la playlist','Playlistfoto zurücksetzen','Restablecer foto de la lista','Reimposta foto playlist','Redefinir foto da playlist','Playlistfoto herstellen','Przywróć zdjęcie playlisty','Återställ spellistbild'],
  'Playlist': ['Playlist','Wiedergabeliste','Lista de reproducción','Playlist','Playlist','Afspeellijst','Playlista','Spellista'],
  'Smart playlist': ['Playlist intelligente','Intelligente Playlist','Lista inteligente','Playlist intelligente','Playlist inteligente','Slimme afspeellijst','Inteligentna playlista','Smart spellista'],
  'Search this playlist': ['Rechercher dans cette playlist','Diese Playlist durchsuchen','Buscar en esta lista','Cerca in questa playlist','Pesquisar nesta playlist','Zoek in deze afspeellijst','Szukaj na tej playliście','Sök i den här spellistan'],
  'Close playlist search': ['Fermer la recherche dans la playlist','Playlist-Suche schließen','Cerrar búsqueda de la lista','Chiudi ricerca playlist','Fechar pesquisa da playlist','Zoeken in afspeellijst sluiten','Zamknij wyszukiwanie playlisty','Stäng spellistsökning'],
  'Edit rules': ['Modifier les règles','Regeln bearbeiten','Editar reglas','Modifica regole','Editar regras','Regels bewerken','Edytuj reguły','Redigera regler'],
  'Delete playlist': ['Supprimer la playlist','Playlist löschen','Eliminar lista','Elimina playlist','Excluir playlist','Afspeellijst verwijderen','Usuń playlistę','Ta bort spellista'],
  'Loading folder…': ['Chargement du dossier…','Ordner wird geladen…','Cargando carpeta…','Caricamento cartella…','Carregando pasta…','Map laden…','Wczytywanie folderu…','Laddar mapp…'],
  'This folder is empty.': ['Ce dossier est vide.','Dieser Ordner ist leer.','Esta carpeta está vacía.','Questa cartella è vuota.','Esta pasta está vazia.','Deze map is leeg.','Ten folder jest pusty.','Den här mappen är tom.'],
  'Add to playlist': ['Ajouter à une playlist','Zur Playlist hinzufügen','Añadir a una lista','Aggiungi alla playlist','Adicionar à playlist','Aan afspeellijst toevoegen','Dodaj do playlisty','Lägg till i spellista'],
  'Shuffle on': ['Lecture aléatoire activée','Zufallswiedergabe an','Aleatorio activado','Casuale attivo','Aleatório ativado','Willekeurig aan','Losowo włączone','Blanda på'],
  'Shuffle off': ['Lecture aléatoire désactivée','Zufallswiedergabe aus','Aleatorio desactivado','Casuale disattivato','Aleatório desativado','Willekeurig uit','Losowo wyłączone','Blanda av'],
  'Loading track': ['Chargement du titre','Titel wird geladen','Cargando canción','Caricamento brano','Carregando música','Nummer laden','Wczytywanie utworu','Laddar låt'],
  'Mini Player': ['Mini-lecteur','Mini-Player','Minirreproductor','Mini player','Mini player','Minispeler','Miniodtwarzacz','Minispelare'],
  'Fullscreen': ['Plein écran','Vollbild','Pantalla completa','Schermo intero','Tela cheia','Volledig scherm','Pełny ekran','Helskärm'],
  'Sleep Timer': ['Minuteur de veille','Sleep-Timer','Temporizador de apagado','Timer di spegnimento','Temporizador de desligamento','Slaaptimer','Wyłącznik czasowy','Sovtimer'],
  'Close the side panel': ['Fermer le panneau latéral','Seitenleiste schließen','Cerrar el panel lateral','Chiudi il pannello laterale','Fechar painel lateral','Zijpaneel sluiten','Zamknij panel boczny','Stäng sidopanelen'],
  'Double-click to like or unlike this song': ['Double-cliquez pour aimer ou ne plus aimer ce titre','Doppelklicken, um diesen Song zu mögen oder nicht mehr zu mögen','Haz doble clic para indicar si te gusta esta canción','Fai doppio clic per mettere o togliere il like a questo brano','Clique duas vezes para curtir ou descurtir esta música','Dubbelklik om dit nummer leuk of niet leuk te vinden','Kliknij dwukrotnie, aby polubić lub cofnąć polubienie utworu','Dubbelklicka för att gilla eller ogilla låten'],
  'Song actions': ['Actions du titre','Song-Aktionen','Acciones de la canción','Azioni brano','Ações da música','Nummeracties','Działania utworu','Låtåtgärder'],
  'Can\'t play': ['Lecture impossible','Kann nicht abgespielt werden','No se puede reproducir','Impossibile riprodurre','Não é possível reproduzir','Kan niet worden afgespeeld','Nie można odtworzyć','Kan inte spelas upp'],
  'Missing file': ['Fichier manquant','Datei fehlt','Falta el archivo','File mancante','Arquivo ausente','Bestand ontbreekt','Brak pliku','Filen saknas'],
  'Ghost': ['Absent','Nicht vorhanden','No disponible','Non presente','Ausente','Ontbreekt','Brak','Saknas'],
  'Quality unknown': ['Qualité inconnue','Qualität unbekannt','Calidad desconocida','Qualità sconosciuta','Qualidade desconhecida','Kwaliteit onbekend','Nieznana jakość','Okänd kvalitet'],
  'Redownload or find a replacement': ['Retélécharger ou trouver un remplacement','Erneut herunterladen oder Ersatz finden','Volver a descargar o buscar un reemplazo','Scarica di nuovo o trova un sostituto','Baixar novamente ou encontrar substituta','Opnieuw downloaden of vervanging zoeken','Pobierz ponownie lub znajdź zamiennik','Ladda ner igen eller hitta en ersättning'],
  'Add to another playlist': ['Ajouter à une autre playlist','Zu einer anderen Playlist hinzufügen','Añadir a otra lista','Aggiungi a un’altra playlist','Adicionar a outra playlist','Aan een andere afspeellijst toevoegen','Dodaj do innej playlisty','Lägg till i en annan spellista'],
  'Edit track info': ['Modifier les informations du titre','Titelinformationen bearbeiten','Editar información de la canción','Modifica info brano','Editar informações da música','Nummerinformatie bewerken','Edytuj informacje o utworze','Redigera låtinformation'],
  'Delete from Library': ['Supprimer de la bibliothèque','Aus Mediathek löschen','Eliminar de la biblioteca','Elimina dalla libreria','Excluir da biblioteca','Verwijderen uit bibliotheek','Usuń z biblioteki','Ta bort från biblioteket'],
  'Unlike song': ['Ne plus aimer','Gefällt mir nicht mehr','Ya no me gusta','Non mi piace più','Descurtir música','Niet meer leuk','Cofnij polubienie','Ogilla låt'],
  'Like song': ['Aimer ce titre','Song gefällt mir','Me gusta','Mi piace','Curtir música','Nummer leuk vinden','Polub utwór','Gilla låt'],
  'More': ['Plus','Mehr','Más','Altro','Mais','Meer','Więcej','Mer'],
  'Replace artwork': ['Remplacer la pochette','Cover ersetzen','Reemplazar portada','Sostituisci copertina','Substituir capa','Artwork vervangen','Zmień okładkę','Byt omslag'],
  'Resolve Ghost Song': ['Associer le titre manquant','Fehlenden Song zuordnen','Resolver canción ausente','Risolvi brano mancante','Resolver música ausente','Ontbrekend nummer koppelen','Rozwiąż brakujący utwór','Matcha saknad låt'],
  'Search manually for a better match': ['Rechercher manuellement une meilleure correspondance','Manuell nach einer besseren Übereinstimmung suchen','Buscar manualmente una coincidencia mejor','Cerca manualmente una corrispondenza migliore','Pesquisar manualmente uma correspondência melhor','Handmatig zoeken naar een betere overeenkomst','Ręcznie wyszukaj lepsze dopasowanie','Sök manuellt efter en bättre matchning'],
  'Your Mixes': ['Vos mixes','Deine Mixe','Tus mezclas','I tuoi mix','Seus mixes','Je mixes','Twoje miksy','Dina mixar'],
  'Suggested for You': ['Suggestions pour vous','Für dich vorgeschlagen','Sugerencias para ti','Suggeriti per te','Sugerido para você','Aanbevolen voor jou','Propozycje dla Ciebie','Förslag för dig'],
  'Save as playlist': ['Enregistrer comme playlist','Als Playlist speichern','Guardar como lista','Salva come playlist','Salvar como playlist','Opslaan als afspeellijst','Zapisz jako playlistę','Spara som spellista'],
  'No local tracks yet. Pick your music folder in Library.': ['Aucun titre local. Choisissez votre dossier de musique dans Bibliothèque.','Noch keine lokalen Titel. Wähle deinen Musikordner in der Mediathek.','Aún no hay canciones locales. Elige tu carpeta de música en Biblioteca.','Nessun brano locale. Scegli la cartella musicale in Libreria.','Ainda não há músicas locais. Escolha a pasta de músicas na Biblioteca.','Nog geen lokale nummers. Kies je muziekmap in Bibliotheek.','Brak lokalnych utworów. Wybierz folder muzyczny w Bibliotece.','Inga lokala låtar ännu. Välj musikmapp i Bibliotek.'],
  'Good morning': ['Bonjour','Guten Morgen','Buenos días','Buongiorno','Bom dia','Goedemorgen','Dzień dobry','God morgon'],
  'Good afternoon': ['Bon après-midi','Guten Tag','Buenas tardes','Buon pomeriggio','Boa tarde','Goedemiddag','Dzień dobry','God eftermiddag'],
  'Good evening': ['Bonsoir','Guten Abend','Buenas noches','Buonasera','Boa noite','Goedenavond','Dobry wieczór','God kväll'],
  'Your music, listening history, and recommendations': ['Votre musique, votre historique d’écoute et vos recommandations','Deine Musik, dein Hörverlauf und Empfehlungen','Tu música, historial de escucha y recomendaciones','La tua musica, la cronologia degli ascolti e i consigli','Sua música, histórico de reprodução e recomendações','Je muziek, luistergeschiedenis en aanbevelingen','Twoja muzyka, historia słuchania i rekomendacje','Din musik, lyssningshistorik och rekommendationer'],
  'Local': ['Local','Lokal','Local','Locale','Local','Lokaal','Lokalne','Lokalt'],
  'Discovery': ['Découverte','Entdecken','Descubrir','Scopri','Descobrir','Ontdekken','Odkrywaj','Upptäck'],
  'Flow': ['Flow','Flow','Flow','Flow','Flow','Flow','Flow','Flow'],
  'Releases': ['Sorties','Veröffentlichungen','Lanzamientos','Uscite','Lançamentos','Releases','Wydania','Utgåvor'],
  'Listen History': ['Historique d’écoute','Hörverlauf','Historial de escucha','Cronologia ascolti','Histórico de reprodução','Luistergeschiedenis','Historia słuchania','Lyssningshistorik'],
  'No listen history yet.': ['Aucun historique d’écoute pour le moment.','Noch kein Hörverlauf vorhanden.','Todavía no hay historial de escucha.','Nessuna cronologia di ascolti.','Ainda não há histórico de reprodução.','Nog geen luistergeschiedenis.','Brak historii słuchania.','Ingen lyssningshistorik ännu.'],

  'What do you want to play? Or paste a link': ['Que voulez-vous écouter ? Ou collez un lien','Was möchtest du hören? Oder Link einfügen','¿Qué quieres escuchar? O pega un enlace','Cosa vuoi ascoltare? Oppure incolla un link','O que você quer ouvir? Ou cole um link','Wat wil je afspelen? Of plak een link','Czego chcesz posłuchać? Wklej też link','Vad vill du spela? Klistra in en länk'],
  'Search, or paste a link to download': ['Rechercher ou coller un lien à télécharger','Suchen oder Download-Link einfügen','Busca o pega un enlace para descargar','Cerca o incolla un link da scaricare','Pesquise ou cole um link para baixar','Zoek of plak een link om te downloaden','Szukaj lub wklej link do pobrania','Sök eller klistra in en länk för nedladdning'],
  'Clear search': ['Effacer la recherche','Suche löschen','Borrar búsqueda','Cancella ricerca','Limpar pesquisa','Zoekopdracht wissen','Wyczyść wyszukiwanie','Rensa sökning'],
  'Play Flow (right-click for a mood)': ['Lancer Flow (clic droit pour choisir une ambiance)','Flow abspielen (Rechtsklick für Stimmung)','Reproducir Flow (clic derecho para elegir un estado de ánimo)','Riproduci Flow (clic destro per scegliere un mood)','Reproduzir Flow (clique com o botão direito para escolher o clima)','Flow afspelen (klik met rechts voor een stemming)','Odtwórz Flow (kliknij prawym, aby wybrać nastrój)','Spela Flow (högerklicka för att välja stämning)'],
  'Play Flow': ['Lancer Flow','Flow abspielen','Reproducir Flow','Riproduci Flow','Reproduzir Flow','Flow afspelen','Odtwórz Flow','Spela Flow'],
  'Remove from history': ['Retirer de l’historique','Aus Verlauf entfernen','Quitar del historial','Rimuovi dalla cronologia','Remover do histórico','Verwijderen uit geschiedenis','Usuń z historii','Ta bort från historiken'],
  'Download Format': ['Format de téléchargement','Downloadformat','Formato de descarga','Formato di download','Formato de download','Downloadformaat','Format pobierania','Nedladdningsformat'],
  'Simultaneous Downloads': ['Téléchargements simultanés','Gleichzeitige Downloads','Descargas simultáneas','Download simultanei','Downloads simultâneos','Gelijktijdige downloads','Równoczesne pobieranie','Samtidiga nedladdningar'],
  'Add Lyrics to Downloads': ['Ajouter les paroles aux téléchargements','Songtexte in Downloads einbetten','Añadir letras a las descargas','Aggiungi testi ai download','Adicionar letras aos downloads','Songteksten aan downloads toevoegen','Dodawaj teksty do pobieranych plików','Lägg till låttexter i nedladdningar'],
  'Simpler Artist Names': ['Noms d’artistes simplifiés','Vereinfachte Künstlernamen','Nombres de artistas simplificados','Nomi artisti semplificati','Nomes de artistas simplificados','Eenvoudigere artiestennamen','Prostsze nazwy artystów','Enklare artistnamn'],
  'Sync Linked Playlists at Launch': ['Synchroniser les playlists liées au démarrage','Verknüpfte Playlists beim Start synchronisieren','Sincronizar listas vinculadas al iniciar','Sincronizza playlist collegate all’avvio','Sincronizar playlists vinculadas ao iniciar','Gekoppelde afspeellijsten synchroniseren bij opstarten','Synchronizuj połączone playlisty przy uruchomieniu','Synkronisera länkade spellistor vid start'],
  'Add Right Away': ['Ajouter immédiatement','Sofort hinzufügen','Añadir de inmediato','Aggiungi subito','Adicionar imediatamente','Direct toevoegen','Dodaj od razu','Lägg till direkt'],
  'Set Genres': ['Définir les genres','Genres festlegen','Definir géneros','Imposta generi','Definir gêneros','Genres instellen','Ustaw gatunki','Ange genrer'],
  'Choose the genre for an artist, album or song yourself.': ['Choisissez vous-même le genre d’un artiste, d’un album ou d’un titre.','Lege das Genre eines Künstlers, Albums oder Songs selbst fest.','Elige tú el género de un artista, álbum o canción.','Scegli tu il genere di un artista, album o brano.','Escolha o gênero de um artista, álbum ou música.','Kies zelf het genre voor een artiest, album of nummer.','Samodzielnie wybierz gatunek artysty, albumu lub utworu.','Välj själv genre för en artist, ett album eller en låt.'],
  'Fill In Genres': ['Compléter les genres','Genres ergänzen','Completar géneros','Completa generi','Preencher gêneros','Genres aanvullen','Uzupełnij gatunki','Fyll i genrer'],
  'Names With a Comma': ['Noms avec une virgule','Namen mit Komma','Nombres con coma','Nomi con virgola','Nomes com vírgula','Namen met een komma','Nazwy z przecinkiem','Namn med kommatecken'],
  'Fill In Artist Pages': ['Compléter les pages d’artistes','Künstlerseiten ergänzen','Completar páginas de artistas','Completa pagine artisti','Preencher páginas de artistas','Artiestpagina’s aanvullen','Uzupełnij strony artystów','Fyll i artistsidor'],
  'Artist Info Source': ['Source des informations sur les artistes','Quelle für Künstlerinfos','Fuente de información de artistas','Fonte info artisti','Fonte de informações dos artistas','Bron voor artiestinformatie','Źródło informacji o artyście','Källa för artistinformation'],
  'Remove Duplicate Songs': ['Supprimer les doublons de titres','Doppelte Songs entfernen','Eliminar canciones duplicadas','Rimuovi brani duplicati','Remover músicas duplicadas','Dubbele nummers verwijderen','Usuń zduplikowane utwory','Ta bort dubbla låtar'],
  'Delete Files Too': ['Supprimer aussi les fichiers','Dateien ebenfalls löschen','Eliminar también los archivos','Elimina anche i file','Excluir os arquivos também','Bestanden ook verwijderen','Usuń także pliki','Ta bort filer också'],
  'Look Up Missing Info': ['Rechercher les informations manquantes','Fehlende Infos suchen','Buscar información que falta','Cerca informazioni mancanti','Buscar informações ausentes','Ontbrekende informatie opzoeken','Wyszukaj brakujące informacje','Sök efter saknad information'],
  'Skip Sample Packs': ['Ignorer les packs de samples','Sample-Packs überspringen','Omitir paquetes de samples','Salta i sample pack','Ignorar pacotes de samples','Samplepakketten overslaan','Pomijaj paczki sampli','Hoppa över samplepaket'],
  'Minimum Length': ['Durée minimale','Mindestlänge','Duración mínima','Durata minima','Duração mínima','Minimale lengte','Minimalna długość','Minsta längd'],
  'Colour Background': ['Fond coloré','Farbiger Hintergrund','Fondo con color','Sfondo colorato','Fundo colorido','Gekleurde achtergrond','Kolorowe tło','Färgad bakgrund'],
  'Moving Covers': ['Pochettes animées','Animierte Cover','Portadas animadas','Copertine animate','Capas animadas','Bewegende hoezen','Animowane okładki','Rörliga omslag'],
  'Glass': ['Verre','Glas','Cristal','Vetro','Vidro','Glas','Szkło','Glas'],
  'Waveform': ['Forme d’onde','Wellenform','Forma de onda','Forma d’onda','Forma de onda','Golfvorm','Przebieg fali','Vågform'],
  'Side Panels': ['Panneaux latéraux','Seitenleisten','Paneles laterales','Pannelli laterali','Painéis laterais','Zijpanelen','Panele boczne','Sidopaneler'],
  'Open the Side Panel on Play': ['Ouvrir le panneau latéral à la lecture','Seitenleiste beim Abspielen öffnen','Abrir el panel lateral al reproducir','Apri il pannello laterale alla riproduzione','Abrir painel lateral ao reproduzir','Zijpaneel openen bij afspelen','Otwórz panel boczny podczas odtwarzania','Öppna sidopanelen vid uppspelning'],
  'Local Accounts': ['Comptes locaux','Lokale Konten','Cuentas locales','Account locali','Contas locais','Lokale accounts','Konta lokalne','Lokala konton'],
  'Refresh': ['Actualiser','Aktualisieren','Actualizar','Aggiorna','Atualizar','Vernieuwen','Odśwież','Uppdatera'],
  'No local accounts found.': ['Aucun compte local trouvé.','Keine lokalen Konten gefunden.','No se encontraron cuentas locales.','Nessun account locale trovato.','Nenhuma conta local encontrada.','Geen lokale accounts gevonden.','Nie znaleziono kont lokalnych.','Inga lokala konton hittades.'],
  'Import Metadata': ['Importer les métadonnées','Metadaten importieren','Importar metadatos','Importa metadati','Importar metadados','Metadata importeren','Importuj metadane','Importera metadata'],
  'Full App Export': ['Export complet de l’application','Vollständiger App-Export','Exportación completa de la aplicación','Esportazione completa dell’app','Exportação completa do aplicativo','Volledige app-export','Pełny eksport aplikacji','Fullständig appexport'],
  'Export All': ['Tout exporter','Alles exportieren','Exportar todo','Esporta tutto','Exportar tudo','Alles exporteren','Eksportuj wszystko','Exportera allt'],
  'Import Backup': ['Importer une sauvegarde','Sicherung importieren','Importar copia de seguridad','Importa backup','Importar backup','Back-up importeren','Importuj kopię zapasową','Importera säkerhetskopia'],
  'Export History': ['Exporter l’historique','Verlauf exportieren','Exportar historial','Esporta cronologia','Exportar histórico','Geschiedenis exporteren','Eksportuj historię','Exportera historik'],
}
const TRANSLATIONS = Object.fromEntries(Object.entries(ROWS).map(([phrase, values]) => [
  phrase, Object.fromEntries(LOCALES.map((locale, index) => [locale, values[index]])),
]))

const LanguageContext = createContext({ language: 'en', setLanguage: async () => false, t: value => value })
function readStoredLanguage() {
  try {
    const code = localStorage.getItem('lokal-app-language')
    return APP_LANGUAGES.some(item => item.code === code) ? code : 'en'
  } catch { return 'en' }
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readStoredLanguage)
  const userChangedRef = useRef(false)

  useEffect(() => {
    let alive = true
    Promise.resolve(api.getSettings()).then(settings => {
      if (!alive || userChangedRef.current) return
      const saved = APP_LANGUAGES.find(item => item.code === settings?.app_language)?.code
      if (saved) {
        setLanguageState(saved)
        try { localStorage.setItem('lokal-app-language', saved) } catch {}
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language
  }, [language])

  const setLanguage = useCallback(async (code) => {
    if (!APP_LANGUAGES.some(item => item.code === code)) return false
    userChangedRef.current = true
    setLanguageState(code)
    try { localStorage.setItem('lokal-app-language', code) } catch {}
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lokal:language-changed', { detail: { language: code } }))
    try {
      const result = await api.saveSettings({ app_language: code })
      if (result?.error) throw new Error(result.error)
      return true
    } catch (error) {
      console.error('[i18n] Could not save app language:', error)
      return false
    }
  }, [])

  const t = useCallback((phrase) => {
    if (typeof phrase !== 'string' || language === 'en') return phrase
    return TRANSLATIONS[phrase]?.[language] || phrase
  }, [language])

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>
}

export function useTranslation() {
  return useContext(LanguageContext)
}
