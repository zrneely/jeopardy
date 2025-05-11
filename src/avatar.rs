use std::{io::Write, path::PathBuf};

use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use crate::errors::Error;

pub(crate) struct AvatarManager {
    directory: PathBuf,
    prefix: String,
    max_image_size: usize,
}
impl AvatarManager {
    pub(crate) fn new(
        directory: PathBuf,
        prefix: String,
        max_image_size: usize,
    ) -> Result<Self, Error> {
        Ok(AvatarManager {
            directory,
            prefix,
            max_image_size,
        })
    }

    pub(crate) async fn save_avatar(&self, avatar_data_url: &str) -> Result<String, Error> {
        let mut bytes = Vec::new();
        let mut hasher = Sha256::new();

        let avatar_data_url = data_url::DataUrl::process(avatar_data_url)?;
        let mime = avatar_data_url.mime_type();

        if mime.type_ != "image" {
            return Err(Error::DataUrlType);
        }
        let ext = match mime.subtype.as_str() {
            "jpeg" => "jpg",
            "png" => "png",
            _ => return Err(Error::DataUrlType),
        };

        avatar_data_url.decode(|data| {
            if bytes.len() + data.len() < self.max_image_size {
                hasher.write_all(data).unwrap();
                bytes.extend_from_slice(data);
                Ok(())
            } else {
                log::warn!("Avatar too big: {}!", bytes.len() + data.len());
                Err(Error::AvatarTooBig)
            }
        })?;

        let filename = format!("{:x}.{}", hasher.finalize(), ext);
        let path = self.directory.as_path().join(&filename);

        if !path.exists() {
            let mut file = tokio::fs::File::create(&path).await?;
            file.write_all(&bytes).await?;
        }

        Ok(format!("{}/{}", self.prefix, filename))
    }
}
