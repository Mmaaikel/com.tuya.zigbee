'use strict';

const { Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');
const TuyaSpecificClusterDevice = require('../../lib/TuyaSpecificClusterDevice');

Cluster.addCluster(TuyaSpecificCluster);

const dataPoints = {
	presence: 1,
	static_detection_sensitivity: 2,
	static_detection_distance: 4,
	motion_state: 101,
	fading_time: 102,
	illuminance: 106,
	indicator: 107,
	battery: 121,
	motion_detection_mode: 122,
	motion_detection_sensitivity: 123,

	medium_motion_detection_distance: 104,
	medium_motion_detection_sensitivity: 105
}

const dataTypes = {
	raw: 0, // [ bytes ]
	bool: 1, // [0/1]
	value: 2, // [ 4 byte value ]
	string: 3, // [ N byte string ]
	enum: 4, // [ 0-255 ]
	bitmap: 5, // [ 1,2,4 bytes ] as bits
};

const convertMultiByteNumberPayloadToSingleDecimalNumber = (chunks) => {
	let value = 0;

	for (let i = 0; i < chunks.length; i++) {
		value = value << 8;
		value += chunks[i];
	}

	return value;
};

const getDataValue = (dpValue) => {
	switch (dpValue.datatype) {
		case dataTypes.raw:
			return dpValue.data;
		case dataTypes.bool:
			return dpValue.data[0] === 1;
		case dataTypes.value:
			return convertMultiByteNumberPayloadToSingleDecimalNumber(dpValue.data);
		case dataTypes.string:
			let dataString = '';
			for (let i = 0; i < dpValue.data.length; ++i) {
				dataString += String.fromCharCode(dpValue.data[i]);
			}
			return dataString;
		case dataTypes.enum:
			return dpValue.data[0];
		case dataTypes.bitmap:
			return convertMultiByteNumberPayloadToSingleDecimalNumber(dpValue.data);
	}
}

class occupancySensor extends TuyaSpecificClusterDevice {
	async onNodeInit({ zclNode }) {

		// Get the class
		const tuyaCluster = zclNode.endpoints[1].clusters.tuya;

		tuyaCluster.on("response", value => this.updatePosition( "response", value));
		tuyaCluster.on("report", value => this.updatePosition("report", value));
		tuyaCluster.on("data", value => this.updatePosition("data", value));

		const occupancyCluster = zclNode.endpoints[1].clusters['occupancySensing'];
		if (occupancyCluster) {
			this.log('Occupancy cluster gevonden op endpoint 1');
			occupancyCluster.on('attr.occupancy', (value) => {
				this.log('Occupancy update:', value);
				this.setCapabilityValue('alarm_motion', !!value.occupancy);
			});
		}

		// 2. Probeer de IAS Zone cluster (0x0500) - vaak gebruikt voor alarm/motion
		const iasZoneCluster = zclNode.endpoints[1].clusters['iasZone'];
		if (iasZoneCluster) {
			this.log('IAS Zone cluster gevonden op endpoint 1');
			iasZoneCluster.on('zoneStatusChangeNotification', (data) => {
				this.log('IAS Zone update:', data.zoneStatus);
				this.setCapabilityValue('alarm_motion', data.zoneStatus.alarm1);
			});
		}

		// 3. Batterij rapportage (0x0001)
		const powerCluster = zclNode.endpoints[1].clusters['powerConfiguration'];
		if (powerCluster) {
			powerCluster.on('attr.batteryPercentageRemaining', (value) => {
				this.log('Battery update:', value / 2); // Zigbee stuurt vaak 0-200 voor 0-100%
				this.setCapabilityValue('measure_battery', Math.round(value / 2));
			});
		}
	}

	async updatePosition( type, data) {

		this.log('Received ' + type + ' from tuya cluster:');
		this.log( data )

		const dp = data.dp;
		const value = getDataValue(data);
		const distanceUpdateInterval = this.getSetting('distance_update_interval') ?? 10;

		switch (dp) {
			case dataPoints.static_detection_distance:
			case dataPoints.static_detection_sensitivity:
			case dataPoints.motion_detection_sensitivity:
			case dataPoints.motion_detection_mode:
			case dataPoints.fading_time:
			case dataPoints.indicator:
			case dataPoints.motion_state:
				const keyName = Object.keys(dataPoints).find(key => dataPoints[key] === dp);
				this.log( keyName + " state: " + value)
				break;

			case dataPoints.presence:
				this.log("! alarm motion: " + value)
				// this.setCapabilityValue('alarm_motion', Boolean(value))
				this.setCapabilityValue('alarm_motion', !!value).catch(this.error);
				break;

			case dataPoints.battery:
				this.log("! battery: " + value)
				this.setCapabilityValue('measure_battery', value)
				break;

			case dataPoints.illuminance:
				this.log("! illuminance: " + value)
				// this.setCapabilityValue('illuminance', value)
				this.onIlluminanceMeasuredAttributeReport(value)
				break;

			default:
				this.log('Unknown DP value', dp, value)
		}
	}

	onDeleted() {
		this.log("Occupancy sensor removed")
	}

	async onSettings({ newSettings, changedKeys }) {
		if (changedKeys.includes('static_detection_distance')) {
			this.writeData32(dataPoints.static_detection_distance, newSettings['static_detection_distance'])
		}

		if (changedKeys.includes('static_detection_sensitivity')) {
			this.writeData32(dataPoints.static_detection_sensitivity, newSettings['static_detection_sensitivity'])
		}

		if (changedKeys.includes('motion_detection_sensitivity')) {
			this.writeData32(dataPoints.motion_detection_sensitivity, newSettings['motion_detection_sensitivity'])
		}

		if (changedKeys.includes('indicator')) {
			this.writeData32(dataPoints.indicator, newSettings['indicator'])
		}

		if (changedKeys.includes('fading_time')) {
			this.writeData32(dataPoints.fading_time, newSettings['fading_time'])
		}

		if( changedKeys.includes('motion_detection_mode') ) {
			this.writeData32(dataPoints.motion_detection_mode, newSettings['motion_detection_mode'])
		}
	}

	onIlluminanceMeasuredAttributeReport(measuredValue) {
		this.log('measure_luminance | Luminance - measuredValue (lux):', measuredValue);
		this.setCapabilityValue('measure_luminance', measuredValue);
	}
}

module.exports = occupancySensor;