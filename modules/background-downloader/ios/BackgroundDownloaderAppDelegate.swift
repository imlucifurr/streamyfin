import ExpoModulesCore
import UIKit

public class BackgroundDownloaderAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    if identifier == "com.lutheragda.weflix.backgrounddownloader" {
      BackgroundDownloaderModule.setBackgroundCompletionHandler(completionHandler)
    }
  }
}

