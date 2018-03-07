import Promise from 'bluebird';
import _ from 'lodash';
import axios from 'axios';

const mtUrl = '';

function dimension2Filter(area, value) { // convert dimension to filter
  const { type, values } = value;
  if (type === 'enum') {
    return ['in', area, values];
  }
  return [];
}

function convertDimensions({ slicers, dimensions }) {
  const filters = [];
  _.each(dimensions, (obj, dim) => {
    const { fromSlicer, value } = obj;
    if (fromSlicer) {
      filters.push(dimension2Filter(fromSlicer, slicers[fromSlicer].value));
    } else {
      filters.push(dimension2Filter(dim, value));
    }
  });
  return filters;
}

// function generateMetricRequest({
//   slicers,
//   dimensions,
//   metric,
// }) {
//   const requestDimensions = convertDimensions({ slicers, dimensions })
//     .concat(convertDimensions({ slicers, dimensions: metric.dimensions }));
//   return {
//     name: 'query',
//     parameters: {
//       metrics: metric.value,
//       dimensions: requestDimensions,
//     },
//   };
// }


/**
 * convert data and compute dimension info
 * sample parameters:
 * {
 *  data: [[], [], []],
 *  meta: {
 *    headers: [], // list of header ids
 *    collapsedColumns: [],
 *  }
 * }
 * return new grouped data and header->dimension
 */
function convertData({
  data,
  meta: {
    headers,
    collapsedColumns,
  },
  groupDimensions = [],
  axiesDimensions = [],
  metric,
}) {
  const results = [];
  const series = [];
  _.each(data, (item) => {
    const obj = _.zipObject(headers, item);
    const axiesDim = _.pick(obj, axiesDimensions);
    const groupDim = _.pick(obj, [...groupDimensions, metric.value]);
    const result = _.find(results, axiesDim);
    const serie = _.pick(obj, groupDimensions);
    if (!_.find(series, serie)) {
      series.push(serie);
    }
    if (result) {
      result.children.push(groupDim);
    } else {
      results.push({
        ...axiesDim,
        children: [groupDim],
      });
    }
  });

  const nameTemplate = _.template(metric.nameTemplate);
  const seriesMapper = {};

  const retData = _.map(results, (item) => {
    const axiesData = _.at(item, axiesDimensions);
    const metricData = _.map(series, (serie) => {
      const dataItem = _.find(item.children, serie);
      if (dataItem) {
        return dataItem[metric.value];
      }
      return undefined;
    });
    return [...axiesData, ...metricData];
  });

  const enrichedSerie = { ...series, ...collapsedColumns };
  // Translate enum id to string here and then get newHeaders

  const newHeaders = [...axiesDimensions, ..._.map(series, (serie) => {
    const name = nameTemplate(enrichedSerie);
    const serieName = _.has(seriesMapper, name) ? _.uniqueId(name) : name;

    _.extend(seriesMapper, {
      [serieName]: enrichedSerie,
    });
  })];

  return Promise.resolve({
    source: [newHeaders, ...retData],
    seriesMapper,
  });
}


function fetchData({
  slicers,
  dimensions,
  metrics,
  groupDimensions,
  axiesDimensions,
}) {
  axios.post(mtUrl, _.map(metrics, (metric) => {
    const mergedDimensions = { ...dimensions, ...metric.dimensions };
    return {
      name: 'query',
      parameters: {
        metrics: metric.value,
        dimensions: convertDimensions({ slicers, dimensions: mergedDimensions }),
      },
    };
  })).then(responses => Promise.map(responses, (response, index) => convertData({
    ...response,
    groupDimensions,
    axiesDimensions,
    metric: metrics[index],
  }))).then(results => results[0]); // TODO: realize results merge before check in
}

/**
 *   slicers: {},
 *   section: {
 *     metrics: [],
 *     dimensions: {},
 *     chartType: 'line', //added
 *     mainDimensions: [], //added
 *   }
 */
export function getMetrics({
  slicers = {},
  section = {},
}) {
  return fetchData({
    slicers,
    ...section,
  });
}
