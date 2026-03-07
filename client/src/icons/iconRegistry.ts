import type { DeviceType } from "../deviceTypes";
import { normalizeDeviceType } from "../deviceTypes";

import defaultSimple from "../assets/icons/default_device.svg";
import defaultCockpit from "../assets/icons/default_device.svg";

import backboneSimple from "../assets/icons/backbone_gateway_simple.svg";
import backboneCockpit from "../assets/icons/backbone_gateway.svg";
import coreSiteSimple from "../assets/icons/core_node_simple.svg";
import coreSiteCockpit from "../assets/icons/core_node.svg";
import popSimple from "../assets/icons/pop_simple.svg";
import popCockpit from "../assets/icons/pop.svg";
import routerSimple from "../assets/icons/router_simple.svg";
import routerCockpit from "../assets/icons/router.svg";
import oltSimple from "../assets/icons/olt_simple.svg";
import oltCockpit from "../assets/icons/olt.svg";
import aonSwitchSimple from "../assets/icons/aon_switch_simple.svg";
import aonSwitchCockpit from "../assets/icons/aon_switch.svg";
import splitterSimple from "../assets/icons/splitter_simple.svg";
import splitterCockpit from "../assets/icons/splitter.svg";
import ontSimple from "../assets/icons/ont_simple.svg";
import ontCockpit from "../assets/icons/ont.svg";
import businessOntSimple from "../assets/icons/business_ont_simple.svg";
import businessOntCockpit from "../assets/icons/business_ont.svg";
import aonCpeSimple from "../assets/icons/aon_cpe_simple.svg";
import aonCpeCockpit from "../assets/icons/aon_cpe.svg";
import switchSimple from "../assets/icons/switch_simple.svg";
import switchCockpit from "../assets/icons/switch.svg";
import patchPanelSimple from "../assets/icons/odf_simple.svg";
import patchPanelCockpit from "../assets/icons/odf.svg";
import amplifierSimple from "../assets/icons/nvt_simple.svg";
import amplifierCockpit from "../assets/icons/nvt.svg";

export interface DeviceIconSet {
  simple: string;
  cockpit: string;
}

const ICON_REGISTRY: Record<DeviceType, DeviceIconSet> = {
  BackboneGateway: { simple: backboneSimple, cockpit: backboneCockpit },
  CoreRouter: { simple: routerSimple, cockpit: routerCockpit },
  EdgeRouter: { simple: routerSimple, cockpit: routerCockpit },
  OLT: { simple: oltSimple, cockpit: oltCockpit },
  AONSwitch: { simple: aonSwitchSimple, cockpit: aonSwitchCockpit },
  Splitter: { simple: splitterSimple, cockpit: splitterCockpit },
  ONT: { simple: ontSimple, cockpit: ontCockpit },
  BusinessONT: { simple: businessOntSimple, cockpit: businessOntCockpit },
  AONCPE: { simple: aonCpeSimple, cockpit: aonCpeCockpit },
  Switch: { simple: switchSimple, cockpit: switchCockpit },
  PatchPanel: { simple: patchPanelSimple, cockpit: patchPanelCockpit },
  Amplifier: { simple: amplifierSimple, cockpit: amplifierCockpit },
  POP: { simple: popSimple, cockpit: popCockpit },
  CORE_SITE: { simple: coreSiteSimple, cockpit: coreSiteCockpit },
};

const DEFAULT_ICON_SET: DeviceIconSet = { simple: defaultSimple, cockpit: defaultCockpit };

export const getDeviceIcons = (input: string | DeviceType): DeviceIconSet => {
  const normalized = normalizeDeviceType(input);
  return ICON_REGISTRY[normalized] ?? DEFAULT_ICON_SET;
};

export const getSimpleDeviceIcon = (input: string | DeviceType): string => getDeviceIcons(input).simple;
export const getCockpitDeviceIcon = (input: string | DeviceType): string => getDeviceIcons(input).cockpit;
