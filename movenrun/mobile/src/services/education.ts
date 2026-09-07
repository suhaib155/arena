import AsyncStorage from "@react-native-async-storage/async-storage";
import { createEducationController } from "@/lib/education";

export const education = createEducationController(AsyncStorage);
