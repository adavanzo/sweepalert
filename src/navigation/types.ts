import { NavigatorScreenParams } from '@react-navigation/native';

export type CarsStackParamList = {
  MyCars: undefined;
  CarDetail: { carId: string };
  ReminderEditor: { carId: string };
  ManageCars: undefined;
};

export type RootTabParamList = {
  Cars: NavigatorScreenParams<CarsStackParamList>;
  // `autoLocate` carries a nonce (timestamp) so re-tapping "Park a car here"
  // re-triggers a fresh GPS capture even when the Park tab is already mounted.
  Park: { carId?: string; autoLocate?: number } | undefined;
  Lookup: undefined;
  Alerts: undefined;
  Settings: undefined;
};
