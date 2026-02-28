import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { PublicSystemInfo } from "@jellyfin/sdk/lib/generated-client";
import { Image } from "expo-image";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { t } from "i18next";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Switch,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { Button } from "@/components/Button";
import { Input } from "@/components/common/Input";
import { Text } from "@/components/common/Text";
import { SaveAccountModal } from "@/components/SaveAccountModal";
import { Colors } from "@/constants/Colors";
import { apiAtom, useJellyfin } from "@/providers/JellyfinProvider";
import type { AccountSecurityType } from "@/utils/secureCredentials";

const CredentialsSchema = z.object({
  username: z.string().min(1, t("login.username_required")),
});

const DEFAULT_SERVER_URL = "https://jellyfin.weflix.me";

const Login: React.FC = () => {
  const api = useAtomValue(apiAtom);
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const { setServer, login, initiateQuickConnect } = useJellyfin();

  const {
    apiUrl: _apiUrl,
    username: _username,
    password: _password,
  } = params as { apiUrl: string; username: string; password: string };

  const [, setLoadingServerCheck] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [serverName, setServerName] = useState<string>("");
  const [credentials, setCredentials] = useState<{
    username: string;
    password: string;
  }>({
    username: _username || "",
    password: _password || "",
  });

  // Save account state
  const [saveAccount, setSaveAccount] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [autoConnecting, setAutoConnecting] = useState(false);

  /**
   * A way to auto login based on a link
   */
  useEffect(() => {
    (async () => {
      if (_apiUrl) {
        await setServer({
          address: _apiUrl,
        });

        // Wait for server setup and state updates to complete
        setTimeout(() => {
          if (_username && _password) {
            setCredentials({ username: _username, password: _password });
            login(_username, _password);
          }
        }, 0);
      }
    })();
  }, [_apiUrl, _username, _password]);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: serverName,
      headerLeft: () => null,
    });
  }, [serverName, navigation]);

  const handleLogin = async () => {
    Keyboard.dismiss();

    const result = CredentialsSchema.safeParse(credentials);
    if (!result.success) return;

    if (saveAccount) {
      // Show save account modal to choose security type
      setPendingLogin({
        username: credentials.username,
        password: credentials.password,
      });
      setShowSaveModal(true);
    } else {
      // Login without saving
      await performLogin(credentials.username, credentials.password);
    }
  };

  const performLogin = async (
    username: string,
    password: string,
    options?: {
      saveAccount?: boolean;
      securityType?: AccountSecurityType;
      pinCode?: string;
    },
  ) => {
    setLoading(true);
    try {
      await login(username, password, serverName, options);
    } catch (error) {
      if (error instanceof Error) {
        Alert.alert(t("login.connection_failed"), error.message);
      } else {
        Alert.alert(
          t("login.connection_failed"),
          t("login.an_unexpected_error_occured"),
        );
      }
    } finally {
      setLoading(false);
      setPendingLogin(null);
    }
  };

  const handleSaveAccountConfirm = async (
    securityType: AccountSecurityType,
    pinCode?: string,
  ) => {
    setShowSaveModal(false);
    if (pendingLogin) {
      await performLogin(pendingLogin.username, pendingLogin.password, {
        saveAccount: true,
        securityType,
        pinCode,
      });
    }
  };

  /**
   * Checks the availability and validity of a Jellyfin server URL.
   *
   * This function attempts to connect to a Jellyfin server using the provided URL.
   * It tries both HTTPS and HTTP protocols, with a timeout to handle long 404 responses.
   *
   * @param {string} url - The base URL of the Jellyfin server to check.
   * @returns {Promise<string | undefined>} A Promise that resolves to:
   *   - The full URL (including protocol) if a valid Jellyfin server is found.
   *   - undefined if no valid server is found at the given URL.
   *
   * Side effects:
   * - Sets loadingServerCheck state to true at the beginning and false at the end.
   * - Logs errors and timeout information to the console.
   */
  const checkUrl = useCallback(async (url: string) => {
    setLoadingServerCheck(true);
    const baseUrl = url.replace(/^https?:\/\//i, "");
    const protocols = ["https", "http"];
    try {
      return checkHttp(baseUrl, protocols);
    } catch (e) {
      if (e instanceof Error && e.message === "Server too old") {
        throw e;
      }
      return undefined;
    } finally {
      setLoadingServerCheck(false);
    }
  }, []);

  async function checkHttp(baseUrl: string, protocols: string[]) {
    for (const protocol of protocols) {
      try {
        const response = await fetch(
          `${protocol}://${baseUrl}/System/Info/Public`,
          {
            mode: "cors",
          },
        );
        if (response.ok) {
          const data = (await response.json()) as PublicSystemInfo;
          const serverVersion = data.Version?.split(".");
          if (serverVersion && +serverVersion[0] <= 10) {
            if (+serverVersion[1] < 10) {
              Alert.alert(
                t("login.too_old_server_text"),
                t("login.too_old_server_description"),
              );
              throw new Error("Server too old");
            }
          }
          setServerName(data.ServerName || "");
          return `${protocol}://${baseUrl}`;
        }
      } catch (e) {
        if (e instanceof Error && e.message === "Server too old") {
          throw e;
        }
      }
    }
    return undefined;
  }
  /**
   * Handles the connection attempt to a Jellyfin server.
   *
   * This function trims the input URL, checks its validity using the `checkUrl` function,
   * and sets the server address if a valid connection is established.
   *
   * @param {string} url - The URL of the Jellyfin server to connect to.
   *
   * @returns {Promise<void>}
   *
   * Side effects:
   * - Calls `checkUrl` to validate the server URL.
   * - Shows an alert if the connection fails.
   * - Sets the server address using `setServer` if the connection is successful.
   *
   */
  const handleConnect = useCallback(async (url: string) => {
    url = url.trim().replace(/\/$/, "");
    try {
      const result = await checkUrl(url);
      if (result === undefined) {
        Alert.alert(
          t("login.connection_failed"),
          t("login.could_not_connect_to_server"),
        );
        return;
      }
      await setServer({ address: result });
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      if (_apiUrl || api?.basePath || autoConnecting) {
        return;
      }
      setAutoConnecting(true);
      try {
        await handleConnect(DEFAULT_SERVER_URL);
      } finally {
        setAutoConnecting(false);
      }
    })();
  }, [_apiUrl, api?.basePath, autoConnecting, handleConnect]);

  const handleQuickConnect = async () => {
    try {
      const code = await initiateQuickConnect();
      if (code) {
        Alert.alert(
          t("login.quick_connect"),
          t("login.enter_code_to_login", { code: code }),
          [
            {
              text: t("login.got_it"),
            },
          ],
        );
      }
    } catch (_error) {
      Alert.alert(
        t("login.error_title"),
        t("login.failed_to_initiate_quick_connect"),
      );
    }
  };

  return Platform.isTV ? (
    // TV layout
    <SafeAreaView className='flex-1 bg-black'>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        {api?.basePath ? (
          // ------------ Username/Password view ------------
          <View className='flex-1 items-center justify-center'>
            {/* Safe centered column with max width so TV doesn’t stretch too far */}
            <View className='w-[92%] max-w-[900px] px-2 -mt-12'>
              <Text className='text-3xl font-bold text-white mb-1'>
                {serverName ? (
                  <>
                    {`${t("login.login_to_title")} `}
                    <Text style={{ color: "#e50914" }}>{serverName}</Text>
                  </>
                ) : (
                  t("login.login_title")
                )}
              </Text>

              {/* Username */}
              <Input
                placeholder={t("login.username_placeholder")}
                onChangeText={(text: string) =>
                  setCredentials((prev) => ({ ...prev, username: text }))
                }
                onEndEditing={(e) => {
                  const newValue = e.nativeEvent.text;
                  if (newValue && newValue !== credentials.username) {
                    setCredentials((prev) => ({ ...prev, username: newValue }));
                  }
                }}
                value={credentials.username}
                keyboardType='default'
                returnKeyType='done'
                autoCapitalize='none'
                autoCorrect={false}
                textContentType='username'
                clearButtonMode='while-editing'
                maxLength={500}
                extraClassName='mb-4'
                autoFocus={false}
                blurOnSubmit={true}
              />

              {/* Password */}
              <Input
                placeholder={t("login.password_placeholder")}
                onChangeText={(text: string) =>
                  setCredentials((prev) => ({ ...prev, password: text }))
                }
                onEndEditing={(e) => {
                  const newValue = e.nativeEvent.text;
                  if (newValue && newValue !== credentials.password) {
                    setCredentials((prev) => ({ ...prev, password: newValue }));
                  }
                }}
                value={credentials.password}
                secureTextEntry
                keyboardType='default'
                returnKeyType='done'
                autoCapitalize='none'
                textContentType='password'
                clearButtonMode='while-editing'
                maxLength={500}
                extraClassName='mb-4'
                autoFocus={false}
                blurOnSubmit={true}
              />

              <View className='mt-4'>
                <Button
                  onPress={handleLogin}
                  disabled={!credentials.username.trim()}
                  color='white'
                >
                  {t("login.login_button")}
                </Button>
              </View>
              <View className='mt-3'>
                <Button onPress={handleQuickConnect} color='white'>
                  {t("login.quick_connect")}
                </Button>
              </View>
            </View>
          </View>
        ) : (
          <View className='flex-1 items-center justify-center'>
            <View className='w-[92%] max-w-[900px] -mt-2 items-center'>
              <Text className='text-white text-4xl font-bold text-center'>
                WEFLIX
              </Text>
              <Text className='text-neutral-400 text-base text-center mt-3'>
                Connecting to your server...
              </Text>
              <Text className='text-neutral-500 text-xs text-center mt-1'>
                {DEFAULT_SERVER_URL}
              </Text>
              <View className='mt-4'>
                <ActivityIndicator size='small' color={Colors.primary} />
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  ) : (
    // Mobile layout
    <SafeAreaView style={{ flex: 1, paddingBottom: 16 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {api?.basePath ? (
          <View className='flex flex-col flex-1 justify-center'>
            <View className='px-4 w-full'>
              <View className='flex flex-col space-y-2'>
                <Text className='text-2xl font-bold mb-2'>
                  {serverName ? (
                    <>
                      {`${t("login.login_to_title")} `}
                      <Text style={{ color: "#e50914" }}>{serverName}</Text>
                    </>
                  ) : (
                    t("login.login_title")
                  )}
                </Text>
                <Input
                  placeholder={t("login.username_placeholder")}
                  onChangeText={(text) =>
                    setCredentials((prev) => ({ ...prev, username: text }))
                  }
                  onEndEditing={(e) => {
                    const newValue = e.nativeEvent.text;
                    if (newValue && newValue !== credentials.username) {
                      setCredentials((prev) => ({
                        ...prev,
                        username: newValue,
                      }));
                    }
                  }}
                  value={credentials.username}
                  keyboardType='default'
                  returnKeyType='done'
                  autoCapitalize='none'
                  autoCorrect={false}
                  textContentType='username'
                  clearButtonMode='while-editing'
                  maxLength={500}
                />

                <Input
                  placeholder={t("login.password_placeholder")}
                  onChangeText={(text) =>
                    setCredentials((prev) => ({ ...prev, password: text }))
                  }
                  onEndEditing={(e) => {
                    const newValue = e.nativeEvent.text;
                    if (newValue && newValue !== credentials.password) {
                      setCredentials((prev) => ({
                        ...prev,
                        password: newValue,
                      }));
                    }
                  }}
                  value={credentials.password}
                  secureTextEntry
                  keyboardType='default'
                  returnKeyType='done'
                  autoCapitalize='none'
                  textContentType='password'
                  clearButtonMode='while-editing'
                  maxLength={500}
                />
                <TouchableOpacity
                  onPress={() => setSaveAccount(!saveAccount)}
                  className='flex flex-row items-center py-2'
                  activeOpacity={0.7}
                >
                  <Switch
                    value={saveAccount}
                    onValueChange={setSaveAccount}
                    trackColor={{ false: "#3f3f46", true: Colors.primary }}
                    thumbColor='white'
                  />
                  <Text className='ml-3 text-neutral-300'>
                    {t("save_account.save_for_later")}
                  </Text>
                </TouchableOpacity>
                <View className='flex flex-row items-center justify-between'>
                  <Button
                    onPress={handleLogin}
                    loading={loading}
                    disabled={!credentials.username.trim()}
                    color='white'
                    className='flex-1 mr-2'
                  >
                    {t("login.login_button")}
                  </Button>
                  <TouchableOpacity
                    onPress={handleQuickConnect}
                    className='p-2 bg-white rounded-xl h-12 w-12 flex items-center justify-center border border-gray-200'
                  >
                    <MaterialCommunityIcons
                      name='cellphone-lock'
                      size={24}
                      color='black'
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View className='absolute bottom-0 left-0 w-full px-4 mb-2' />
          </View>
        ) : (
          <View className='flex flex-col flex-1 items-center justify-center w-full'>
            <View className='flex flex-col gap-y-2 px-4 w-full -mt-36 items-center'>
              <Image
                style={{
                  width: 100,
                  height: 100,
                  marginLeft: -23,
                  marginBottom: -20,
                }}
                source={require("@/assets/images/icon-ios-plain.png")}
              />
              <Text className='text-3xl font-bold'>WEFLIX</Text>
              <Text className='text-neutral-500'>
                Connecting to your server...
              </Text>
              <Text className='text-neutral-600 text-xs'>
                {DEFAULT_SERVER_URL}
              </Text>
              <View className='mt-4'>
                <ActivityIndicator size='small' color={Colors.primary} />
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Save Account Modal */}
      <SaveAccountModal
        visible={showSaveModal}
        onClose={() => {
          setShowSaveModal(false);
          setPendingLogin(null);
        }}
        onSave={handleSaveAccountConfirm}
        username={pendingLogin?.username || credentials.username}
      />
    </SafeAreaView>
  );
};

export default Login;
