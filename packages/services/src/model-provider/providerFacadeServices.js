import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
export const IProviderSettingsService = createServiceDescriptor(ServiceChannels.ProviderSettings);
export const IModelSelectionService = createServiceDescriptor(ServiceChannels.ModelSelection);
