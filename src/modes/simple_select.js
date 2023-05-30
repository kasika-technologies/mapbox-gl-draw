import * as CommonSelectors from '../lib/common_selectors';
import mouseEventPoint from '../lib/mouse_event_point';
import createSupplementaryPoints from '../lib/create_supplementary_points';
import StringSet from '../lib/string_set';
import doubleClickZoom from '../lib/double_click_zoom';
import * as Constants from '../constants';
import maplibregl from "maplibre-gl";
import constrainFeatureMovement from '../lib/constrain_feature_movement';

const SimpleSelect = {
  markerInteraction: false,
  selectedMarkerColor: Constants.MARKER_SELECTED_COLOR
};

SimpleSelect.onSetup = function (opts) {
  // turn the opts into state.
  const state = {
    dragMoveLocation: null,
    boxSelectStartLocation: null,
    boxSelectElement: undefined,
    boxSelecting: false,
    canBoxSelect: false,
    dragMoving: false,
    canDragMove: false,
    initiallySelectedFeatureIds: opts.featureIds || []
  };

  this.setSelected(state.initiallySelectedFeatureIds.filter(id => this.getFeature(id) !== undefined));
  this.fireActionable();

  this.setActionableState({
    combineFeatures: true,
    uncombineFeatures: true,
    trash: true
  });

  return state;
};

SimpleSelect.fireUpdate = function () {
  this.map.fire(Constants.events.UPDATE, {
    action: Constants.updateActions.MOVE,
    features: this.getSelected().map(f => f.toGeoJSON())
  });
};

SimpleSelect.fireActionable = function () {
  const selectedFeatures = this.getSelected();

  const multiFeatures = selectedFeatures.filter(
    feature => this.isInstanceOf('MultiFeature', feature)
  );

  let combineFeatures = false;

  if (selectedFeatures.length > 1) {
    combineFeatures = true;
    const featureType = selectedFeatures[0].type.replace('Multi', '');
    selectedFeatures.forEach((feature) => {
      if (feature.type.replace('Multi', '') !== featureType) {
        combineFeatures = false;
      }
    });
  }

  const uncombineFeatures = multiFeatures.length > 0;
  const trash = selectedFeatures.length > 0;

  this.setActionableState({
    combineFeatures, uncombineFeatures, trash
  });
};

SimpleSelect.getUniqueIds = function (allFeatures) {
  if (!allFeatures.length) return [];
  const ids = allFeatures.map(s => s.properties.id)
    .filter(id => id !== undefined)
    .reduce((memo, id) => {
      memo.add(id);
      return memo;
    }, new StringSet());

  return ids.values();
};

SimpleSelect.stopExtendedInteractions = function (state) {
  if (state.boxSelectElement) {
    if (state.boxSelectElement.parentNode) state.boxSelectElement.parentNode.removeChild(state.boxSelectElement);
    state.boxSelectElement = null;
  }

  this.map.dragPan.enable();

  state.boxSelecting = false;
  state.canBoxSelect = false;
  state.dragMoving = false;
  state.canDragMove = false;
};

SimpleSelect.onStop = function () {
  doubleClickZoom.enable(this);
};

SimpleSelect.onMouseMove = function (state, e) {
  const isFeature = CommonSelectors.isFeature(e);

  if (isFeature && state.dragMoving) this.fireUpdate();

  // On mousemove that is not a drag, stop extended interactions.
  // This is useful if you drag off the canvas, release the button,
  // then move the mouse back over the canvas --- we don't allow the
  // interaction to continue then, but we do let it continue if you held
  // the mouse button that whole time
  this.stopExtendedInteractions(state);

  // Skip render
  return true;
};

SimpleSelect.onMouseOut = function (state) {
  // As soon as you mouse leaves the canvas, update the feature
  if (state.dragMoving) return this.fireUpdate();

  // Skip render
  return true;
};

SimpleSelect.onTap = SimpleSelect.onClick = function (state, e) {
  // Click (with or without shift) on no feature
  if (CommonSelectors.noTarget(e)) return this.clickAnywhere(state, e); // also tap
  if (CommonSelectors.isOfMetaType(Constants.meta.VERTEX)(e)) return this.clickOnVertex(state, e); //tap
  if (CommonSelectors.isFeature(e)) return this.clickOnFeature(state, e);
};

SimpleSelect.clickAnywhere = function (state) {
  if (!this.markerInteraction) {
    // Clear the re-render selection
    const wasSelected = this.getSelectedIds();
    if (wasSelected.length) {
      this.clearSelectedFeatures();
      // wasSelected.forEach(id => this.doRender(id))
      wasSelected.forEach((id) => {
        this.doRender(id);

        // markerの色を戻す
        const markerId = `marker-${id}`;
        const el = document.getElementById(markerId);
        if (el) {
          el.style.backgroundColor = el.dataset.backgroundColor;
        }
      });
    }
    doubleClickZoom.enable(this);
    this.stopExtendedInteractions(state);
  }
};

SimpleSelect.clickOnVertex = function (state, e) {
  // Enter direct select mode
  this.changeMode(Constants.modes.DIRECT_SELECT, {
    featureId: e.featureTarget.properties.parent,
    coordPath: e.featureTarget.properties.coord_path,
    startPos: e.lngLat
  });
  this.updateUIClasses({mouse: Constants.cursors.MOVE});
};

SimpleSelect.startOnActiveFeature = function (state, e) {
  // Stop any already-underway extended interactions
  this.stopExtendedInteractions(state);

  // Disable map.dragPan immediately so it can't start
  this.map.dragPan.disable();

  // Re-render it and enable drag move
  this.doRender(e.featureTarget.properties.id);

  // Set up the state for drag moving
  state.canDragMove = true;
  state.dragMoveLocation = e.lngLat;
};

SimpleSelect.clickOnFeature = function (state, e) {
  const that = this;

  // Stop everything
  doubleClickZoom.disable(this);
  this.stopExtendedInteractions(state);

  const isShiftClick = CommonSelectors.isShiftDown(e);
  const selectedFeatureIds = this.getSelectedIds();
  const featureId = e.featureTarget.properties.id;
  const isFeatureSelected = this.isSelected(featureId);

  // Click (without shift) on any selected feature but a point
  if (!isShiftClick && isFeatureSelected && this.getFeature(featureId).type !== Constants.geojsonTypes.POINT) {
    // Enter direct select mode
    return this.changeMode(Constants.modes.DIRECT_SELECT, {
      featureId
    });
  }

  // Shift-click on a selected feature
  if (isFeatureSelected && isShiftClick) {
    // Deselect it
    this.deselect(featureId);
    this.updateUIClasses({mouse: Constants.cursors.POINTER});
    if (selectedFeatureIds.length === 1) {
      doubleClickZoom.enable(this);
    }
    // Shift-click on an unselected feature
  } else if (!isFeatureSelected && isShiftClick) {
    // Add it to the selection
    this.select(featureId);
    this.updateUIClasses({mouse: Constants.cursors.MOVE});
    // Click (without shift) on an unselected feature
  } else if (!isFeatureSelected && !isShiftClick) {
    // Make it the only selected feature

    // deselect already selected markers
    selectedFeatureIds.forEach((id) => {
      that.doRender(id);

      const el = document.getElementById(`marker-${id}`);
      if (el) {
        el.style.backgroundColor = el.dataset.backgroundColor;
        el.marker.setDraggable(false);
      }
    });

    const el = document.getElementById(`marker-${featureId}`);
    if (el) {
      el.style.backgroundColor = Constants.MARKER_SELECTED_COLOR;
      el.marker.setDraggable(true);
    }

    this.setSelected(featureId);
    this.updateUIClasses({mouse: Constants.cursors.MOVE});
  }

  // No matter what, re-render the clicked feature
  this.doRender(featureId);
};

SimpleSelect.onMouseDown = function (state, e) {
  if (CommonSelectors.isActiveFeature(e)) return this.startOnActiveFeature(state, e);
  if (this.drawConfig.boxSelect && CommonSelectors.isShiftMousedown(e)) return this.startBoxSelect(state, e);
};

SimpleSelect.startBoxSelect = function (state, e) {
  this.stopExtendedInteractions(state);
  this.map.dragPan.disable();
  // Enable box select
  state.boxSelectStartLocation = mouseEventPoint(e.originalEvent, this.map.getContainer());
  state.canBoxSelect = true;
};

SimpleSelect.onTouchStart = function (state, e) {
  if (CommonSelectors.isActiveFeature(e)) return this.startOnActiveFeature(state, e);
};

SimpleSelect.onDrag = function (state, e) {
  if (state.canDragMove) return this.dragMove(state, e);
  if (this.drawConfig.boxSelect && state.canBoxSelect) return this.whileBoxSelect(state, e);
};

SimpleSelect.whileBoxSelect = function (state, e) {
  state.boxSelecting = true;
  this.updateUIClasses({mouse: Constants.cursors.ADD});

  // Create the box node if it doesn't exist
  if (!state.boxSelectElement) {
    state.boxSelectElement = document.createElement('div');
    state.boxSelectElement.classList.add(Constants.classes.BOX_SELECT);
    this.map.getContainer().appendChild(state.boxSelectElement);
  }

  // Adjust the box node's width and xy position
  const current = mouseEventPoint(e.originalEvent, this.map.getContainer());
  const minX = Math.min(state.boxSelectStartLocation.x, current.x);
  const maxX = Math.max(state.boxSelectStartLocation.x, current.x);
  const minY = Math.min(state.boxSelectStartLocation.y, current.y);
  const maxY = Math.max(state.boxSelectStartLocation.y, current.y);
  const translateValue = `translate(${minX}px, ${minY}px)`;
  state.boxSelectElement.style.transform = translateValue;
  state.boxSelectElement.style.WebkitTransform = translateValue;
  state.boxSelectElement.style.width = `${maxX - minX}px`;
  state.boxSelectElement.style.height = `${maxY - minY}px`;
};

SimpleSelect.dragMove = function (state, e) {
  // Dragging when drag move is enabled
  state.dragMoving = true;
  e.originalEvent.stopPropagation();

  const delta = {
    lng: e.lngLat.lng - state.dragMoveLocation.lng,
    lat: e.lngLat.lat - state.dragMoveLocation.lat
  };

  this.moveFeatures(this.getSelected(), delta);

  state.dragMoveLocation = e.lngLat;
};

SimpleSelect.onTouchEnd = SimpleSelect.onMouseUp = function (state, e) {
  const that = this;
  // End any extended interactions
  if (state.dragMoving) {
    this.fireUpdate();
  } else if (state.boxSelecting) {
    const bbox = [
      state.boxSelectStartLocation,
      mouseEventPoint(e.originalEvent, this.map.getContainer())
    ];

    const featuresInBox = this.featuresAt(null, bbox, 'click');
    const idsToSelect = this.getUniqueIds(featuresInBox)
      .filter(id => !this.isSelected(id));

    if (idsToSelect.length) {
      this.select(idsToSelect);
      idsToSelect.forEach((id) => {
        this.doRender(id);
        // boxSelect中にマーカーがあるかどうか判定し、ある場合は選択する
        const el = document.getElementById(`marker-${id}`);
        if (el) {
          el.style.backgroundColor = that.selectedMarkerColor;
          el.marker.setDraggable(true);
        }
      });
      this.updateUIClasses({mouse: Constants.cursors.MOVE});
    }
  }
  this.stopExtendedInteractions(state);
};

SimpleSelect.toDisplayFeatures = function (state, geojson, display) {
  const that = this;

  geojson.properties.active = (this.isSelected(geojson.properties.id)) ?
    Constants.activeStates.ACTIVE : Constants.activeStates.INACTIVE;

  if (geojson.geometry.type === 'Point') {
    if (Object.hasOwn(geojson.properties, 'user_mode')) {
      if (geojson.properties['user_mode'] === 'marker') {
        const color = geojson.properties['user_marker-color'] || 'red';
        const id = geojson.properties.id;
        const elementId = `marker-${geojson.properties.id}`;

        let el = document.getElementById(elementId);
        if (!el) {
          el = document.createElement('div');
          el.classList.add('mapapa-marker');

          el.id = elementId;
          el.dataset.id = id;
          el.dataset.backgroundColor = color;
          el.innerHTML = '';
          el.style.backgroundColor = color;

          const marker = new maplibregl.Marker(el, {
            offset: [Constants.MARKER_OFFSET_X, Constants.MARKER_OFFSET_Y],
            draggable: false,
          }).setLngLat(geojson.geometry.coordinates);

          marker.getElement().marker = marker;

          marker.getElement().addEventListener('mousedown', () => {
            that.markerInteraction = true;
            // onMousedown相当処理
          });
          marker.getElement().addEventListener('click', (event) => {
            event.stopPropagation();

            // onClick相当処理 clickOnFeature相当処理
            doubleClickZoom.disable(that);
            this.stopExtendedInteractions(state);

            const isShiftClick = event.shiftKey;
            const selectedFeatureIds = that.getSelectedIds();
            const featureId = id;
            const isFeatureSelected = that.isSelected(featureId);

            state.dragMoveLocation = marker.getLngLat();

            // Shift click on a selected feature
            if (isFeatureSelected && isShiftClick) {
              // deselect it
              this.deselect(featureId);
              this.updateUIClasses({mouse: Constants.cursors.POINTER});

              marker.getElement().style.backgroundColor = color;
              marker.setDraggable(false);
              if (selectedFeatureIds.length === 1) {
                doubleClickZoom.enable(that);
              }

              // Shift-click on an unselected feature
            } else if (!isFeatureSelected && isShiftClick) {
              // add it to the selection
              that.select(featureId);
              marker.setDraggable(true);
              marker.getElement().style.backgroundColor = that.selectedMarkerColor;
              that.updateUIClasses({mouse: Constants.cursors.MOVE});

              // click (without shift) on an unselected feature
            } else if (!isFeatureSelected && !isShiftClick) {
              selectedFeatureIds.forEach(id => that.doRender(id));
              that.setSelected(featureId);
              that.updateUIClasses({mouse: Constants.cursors.MOVE});

              const els = document.querySelectorAll('.mapapa-marker');
              els.forEach((el) => {
                // TODO .mapapa-marker.activeで選択できるようにして高速化を図る
                el.marker.setDraggable(false);
                el.style.backgroundColor = el.dataset.backgroundColor;
              });

              marker.setDraggable(true);
              marker.getElement().style.backgroundColor = that.selectedMarkerColor;
            }

            // no matter what, re-render the clicked feature
            that.doRender(featureId);
            that.markerInteraction = false;
          });
          marker.getElement().addEventListener('mouseup', () => {
            // that.markerInteraction = false
          });
          marker.on('drag', () => {
            state.dragMoving = true;

            if (state.dragMoveLocation) {
              const delta = {
                lng: marker.getLngLat().lng - state.dragMoveLocation.lng,
                lat: marker.getLngLat().lat - state.dragMoveLocation.lat
              };

              that.moveFeatures(this.getSelected(), delta);
            }

            state.dragMoveLocation = marker.getLngLat();
          });
          marker.on('dragstart', () => {
          });
          marker.on('dragend', () => {
            that.markerInteraction = false;
          });

          // set draggable to true just after the marker added
          if (geojson.properties.active === 'true') {
            marker.setDraggable(true);
            marker.getElement().style.backgroundColor = that.selectedMarkerColor;
          }

          marker.addTo(this.map);
        }
      }
    }
  }

  display(geojson);
  this.fireActionable();
  if (geojson.properties.active !== Constants.activeStates.ACTIVE ||
    geojson.geometry.type === Constants.geojsonTypes.POINT) return;
  createSupplementaryPoints(geojson).forEach(display);
};

SimpleSelect.onTrash = function () {
  const wasSelected = this.getSelectedIds();
  this.deleteFeature(this.getSelectedIds());

  wasSelected.forEach((selected) => {
    const el = document.getElementById(`marker-${selected}`);
    if (el) {
      const marker = el.marker;
      marker.remove();
    }
  });

  this.fireActionable();
};

SimpleSelect.onCombineFeatures = function () {
  const selectedFeatures = this.getSelected();

  if (selectedFeatures.length === 0 || selectedFeatures.length < 2) return;

  const coordinates = [], featuresCombined = [];
  const featureType = selectedFeatures[0].type.replace('Multi', '');

  for (let i = 0; i < selectedFeatures.length; i++) {
    const feature = selectedFeatures[i];

    if (feature.type.replace('Multi', '') !== featureType) {
      return;
    }
    if (feature.type.includes('Multi')) {
      feature.getCoordinates().forEach((subcoords) => {
        coordinates.push(subcoords);
      });
    } else {
      coordinates.push(feature.getCoordinates());
    }

    featuresCombined.push(feature.toGeoJSON());
  }

  if (featuresCombined.length > 1) {
    const multiFeature = this.newFeature({
      type: Constants.geojsonTypes.FEATURE,
      properties: featuresCombined[0].properties,
      geometry: {
        type: `Multi${featureType}`,
        coordinates
      }
    });

    this.addFeature(multiFeature);
    this.deleteFeature(this.getSelectedIds(), {silent: true});
    this.setSelected([multiFeature.id]);

    this.map.fire(Constants.events.COMBINE_FEATURES, {
      createdFeatures: [multiFeature.toGeoJSON()],
      deletedFeatures: featuresCombined
    });
  }
  this.fireActionable();
};

SimpleSelect.onUncombineFeatures = function () {
  const selectedFeatures = this.getSelected();
  if (selectedFeatures.length === 0) return;

  const createdFeatures = [];
  const featuresUncombined = [];

  for (let i = 0; i < selectedFeatures.length; i++) {
    const feature = selectedFeatures[i];

    if (this.isInstanceOf('MultiFeature', feature)) {
      feature.getFeatures().forEach((subFeature) => {
        this.addFeature(subFeature);
        subFeature.properties = feature.properties;
        createdFeatures.push(subFeature.toGeoJSON());
        this.select([subFeature.id]);
      });
      this.deleteFeature(feature.id, {silent: true});
      featuresUncombined.push(feature.toGeoJSON());
    }
  }

  if (createdFeatures.length > 1) {
    this.map.fire(Constants.events.UNCOMBINE_FEATURES, {
      createdFeatures,
      deletedFeatures: featuresUncombined
    });
  }
  this.fireActionable();
};

SimpleSelect.moveFeatures = function(features, delta) {
  const constrainedDelta = constrainFeatureMovement(features.map(feature => feature.toGeoJSON()), delta);

  features.forEach((feature) => {
    const currentCoordinates = feature.getCoordinates();

    const moveCoordinate = (coord) => {
      const point = {
        lng: coord[0] + constrainedDelta.lng,
        lat: coord[1] + constrainedDelta.lat
      };
      return [point.lng, point.lat];
    };
    const moveRing = ring => ring.map(coord => moveCoordinate(coord));
    const moveMultiPolygon = multi => multi.map(ring => moveRing(ring));

    let nextCoordinates;
    if (feature.type === Constants.geojsonTypes.POINT) {
      nextCoordinates = moveCoordinate(currentCoordinates);
    } else if (feature.type === Constants.geojsonTypes.LINE_STRING || feature.type === Constants.geojsonTypes.MULTI_POINT) {
      nextCoordinates = currentCoordinates.map(moveCoordinate);
    } else if (feature.type === Constants.geojsonTypes.POLYGON || feature.type === Constants.geojsonTypes.MULTI_LINE_STRING) {
      nextCoordinates = currentCoordinates.map(moveRing);
    } else if (feature.type === Constants.geojsonTypes.MULTI_POLYGON) {
      nextCoordinates = currentCoordinates.map(moveMultiPolygon);
    }

    feature.incomingCoords(nextCoordinates);

    if (feature.type === 'Point') {
      if (Object.hasOwn(feature.properties, 'mode') && feature.properties.mode === 'marker') {
        const el = document.getElementById(`marker-${feature.id}`);
        if (el) {
          el.marker.setLngLat(feature.coordinates);
        }
      }
    }
  });
};

export default SimpleSelect;
