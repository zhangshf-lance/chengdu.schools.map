const { REGIONS } = require('../../utils/school-data');

const TYPE_LABEL = {
  primary: '小学',
  middle: '初中'
};

const TYPE_COLOR = {
  primary: '#2563eb',
  middle: '#059669'
};

const REGION_IDS = Object.keys(REGIONS);

function pointsFromPolygon(polygon) {
  return (polygon || []).map(([longitude, latitude]) => ({ longitude, latitude }));
}

function getBoundaryPolygons(region) {
  if (Array.isArray(region.boundaries) && region.boundaries.length) return region.boundaries;
  if (Array.isArray(region.boundary) && region.boundary.length) return [region.boundary];
  if (Array.isArray(region.subareas) && region.subareas.length) {
    return region.subareas.flatMap(area => area.boundaryParts || []);
  }
  return [];
}

function groupModeText(type) {
  if (type === 'single') return '单校划片';
  if (type === 'reference') return '辅助绑定';
  return '多校电脑随机';
}

function getSchoolGroups(region, schoolName) {
  return (region.groups || [])
    .filter(group => {
      const primaries = group.primaries || [];
      const middles = group.middles || [];
      return primaries.includes(schoolName) || middles.includes(schoolName);
    })
    .map(group => {
      const isPrimary = (group.primaries || []).includes(schoolName);
      return {
        id: group.id,
        name: group.name,
        modeText: groupModeText(group.type),
        linked: isPrimary ? (group.middles || []) : (group.primaries || [])
      };
    });
}

function normalizeSchool(region, school) {
  const groups = getSchoolGroups(region, school.name);
  return {
    ...school,
    longitude: school.loc?.[0],
    latitude: school.loc?.[1],
    typeLabel: TYPE_LABEL[school.type] || school.type,
    groupText: groups.map(g => g.name).join(' / '),
    groups,
    zone: school.zone || '暂无公开划片范围数据'
  };
}

Page({
  data: {
    regionId: REGION_IDS[0],
    regionIndex: 0,
    regions: [],
    regionNames: [],
    currentRegion: { name: '', schools: [], source: '' },
    longitude: 104.066,
    latitude: 30.66,
    scale: 11,
    typeFilter: 'all',
    searchKeyword: '',
    markers: [],
    polygons: [],
    polylines: [],
    filteredSchools: [],
    selectedSchool: null,
    selectedSchoolName: ''
  },

  onLoad() {
    const regions = REGION_IDS.map(id => ({
      id,
      name: REGIONS[id].name,
      count: REGIONS[id].schools.length
    }));
    this.setData({
      regions,
      regionNames: regions.map(region => region.name)
    });
    this.switchRegion(this.data.regionId, false);
  },

  switchRegion(regionId, clearSearch = true) {
    const region = REGIONS[regionId];
    if (!region) return;

    const regionIndex = REGION_IDS.indexOf(regionId);
    const nextState = {
      regionId,
      regionIndex,
      currentRegion: region,
      longitude: region.center?.[0] || 104.066,
      latitude: region.center?.[1] || 30.66,
      scale: region.zoom || 11,
      selectedSchool: null,
      selectedSchoolName: '',
      polygons: this.buildPolygons(region),
      polylines: this.buildPolylines(region)
    };

    if (clearSearch) nextState.searchKeyword = '';
    this.setData(nextState, () => this.refreshSchools());
  },

  buildPolygons(region) {
    return getBoundaryPolygons(region)
      .filter(polygon => polygon.length >= 3)
      .map((polygon, index) => ({
        points: pointsFromPolygon(polygon),
        strokeWidth: 2,
        strokeColor: index === 1 ? '#7c3aed' : '#9f2b18',
        fillColor: index === 1 ? '#7c3aed16' : '#9f2b1818',
        zIndex: 1
      }));
  },

  buildPolylines(region) {
    const subareaLines = (region.subareas || []).flatMap(area => {
      const color = area.color || '#2563eb';
      return (area.boundaryParts || []).map(part => ({
        points: pointsFromPolygon(part),
        color,
        width: 2,
        dottedLine: true,
        zIndex: 2
      }));
    });

    if (subareaLines.length) return subareaLines;

    return getBoundaryPolygons(region).map(polygon => ({
      points: pointsFromPolygon(polygon),
      color: '#9f2b18',
      width: 2,
      dottedLine: false,
      zIndex: 2
    }));
  },

  refreshSchools() {
    const region = REGIONS[this.data.regionId];
    const keyword = this.data.searchKeyword.trim().toLowerCase();
    const typeFilter = this.data.typeFilter;
    const schools = region.schools
      .map(school => normalizeSchool(region, school))
      .filter(school => {
        if (typeFilter !== 'all' && school.type !== typeFilter) return false;
        if (!keyword) return true;
        return [school.name, school.district, school.zone, school.groupText]
          .some(value => String(value || '').toLowerCase().includes(keyword));
      });

    this.setData({
      filteredSchools: schools,
      markers: schools.map((school, index) => this.buildMarker(school, index))
    });
  },

  buildMarker(school, index) {
    const selected = this.data.selectedSchool?.name === school.name;
    const color = selected ? '#ea580c' : (TYPE_COLOR[school.type] || '#2563eb');
    return {
      id: index,
      schoolName: school.name,
      longitude: school.longitude,
      latitude: school.latitude,
      width: selected ? 34 : 28,
      height: selected ? 34 : 28,
      iconPath: school.type === 'middle' ? '/assets/marker-middle.png' : '/assets/marker-primary.png',
      zIndex: selected ? 99 : 10,
      callout: {
        content: school.name,
        color,
        fontSize: 12,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#ffffff',
        bgColor: '#ffffff',
        padding: 6,
        display: selected ? 'ALWAYS' : 'BYCLICK'
      }
    };
  },

  selectSchool(name, moveMap = true) {
    const region = REGIONS[this.data.regionId];
    const raw = region.schools.find(school => school.name === name);
    if (!raw) return;
    const selectedSchool = normalizeSchool(region, raw);
    this.setData({
      selectedSchool,
      selectedSchoolName: selectedSchool.name,
      longitude: moveMap ? selectedSchool.longitude : this.data.longitude,
      latitude: moveMap ? selectedSchool.latitude : this.data.latitude,
      scale: moveMap ? Math.max(this.data.scale, 15) : this.data.scale
    }, () => this.refreshSchools());
  },

  onRegionPickerChange(event) {
    const index = Number(event.detail.value);
    this.switchRegion(REGION_IDS[index]);
  },

  onRegionTap(event) {
    this.switchRegion(event.currentTarget.dataset.id);
  },

  onTypeTap(event) {
    this.setData({
      typeFilter: event.currentTarget.dataset.type,
      selectedSchool: null,
      selectedSchoolName: ''
    }, () => this.refreshSchools());
  },

  onSearchInput(event) {
    this.setData({
      searchKeyword: event.detail.value,
      selectedSchool: null,
      selectedSchoolName: ''
    }, () => this.refreshSchools());
  },

  clearSearch() {
    this.setData({
      searchKeyword: '',
      selectedSchool: null,
      selectedSchoolName: ''
    }, () => this.refreshSchools());
  },

  onMarkerTap(event) {
    const marker = this.data.markers.find(item => item.id === event.detail.markerId);
    if (marker) this.selectSchool(marker.schoolName, false);
  },

  onSchoolTap(event) {
    this.selectSchool(event.currentTarget.dataset.name);
  },

  onLinkedSchoolTap(event) {
    const name = event.currentTarget.dataset.name;
    const exists = REGIONS[this.data.regionId].schools.some(school => school.name === name);
    if (exists) this.selectSchool(name);
  },

  closeDetail() {
    this.setData({ selectedSchool: null, selectedSchoolName: '' }, () => this.refreshSchools());
  },

  noop() {}
});
